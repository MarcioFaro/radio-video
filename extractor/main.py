import os
import re
import time
import json
import glob
import logging
import asyncio
from typing import Optional

import httpx
import yt_dlp
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="Radio Video Extractor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VIDEO_ID_RE = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})")

POT_BASE_URL = os.environ.get("POT_BASE_URL", "http://host.docker.internal:4416")
PIPED_INSTANCES = os.environ.get(
    "PIPED_INSTANCES",
    "pipedapi.smnz.de,api.piped.private.coffee,pipedapi.adminforge.de",
).split(",")

DOWNLOADS_DIR = "/app/downloads"
MAX_CACHE_BYTES = 15 * 1024 * 1024 * 1024  # 15 GB

if not os.path.exists(DOWNLOADS_DIR):
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)

class ExtractRequest(BaseModel):
    url: str

def get_video_id(url: str) -> Optional[str]:
    match = VIDEO_ID_RE.search(url)
    return match.group(1) if match else None

# ---------------------------------------------------------------------------
# Background Cleaner
# ---------------------------------------------------------------------------
def cleanup_cache():
    try:
        files = glob.glob(os.path.join(DOWNLOADS_DIR, "*"))
        if not files:
            return
            
        total_size = sum(os.path.getsize(f) for f in files if os.path.isfile(f))
        if total_size <= MAX_CACHE_BYTES:
            return
            
        logging.info(f"Limpeza de cache iniciada. Tamanho atual: {total_size / 1024 / 1024:.2f} MB")
        
        # Ordena os arquivos do mais antigo para o mais novo
        files.sort(key=lambda x: os.path.getatime(x))
        
        target_size = 12 * 1024 * 1024 * 1024  # Limpa até sobrar 12GB
        for f in files:
            size = os.path.getsize(f)
            os.remove(f)
            total_size -= size
            if total_size <= target_size:
                break
        logging.info(f"Limpeza de cache concluída. Tamanho final: {total_size / 1024 / 1024:.2f} MB")
    except Exception as e:
        logging.error("Erro na limpeza do cache: %s", e)

@app.on_event("startup")
async def startup_event():
    async def cleanup_loop():
        while True:
            await asyncio.sleep(600)  # Roda a cada 10 min
            cleanup_cache()
    asyncio.create_task(cleanup_loop())


# ---------------------------------------------------------------------------
# Erros
# ---------------------------------------------------------------------------
ERROR_KEYWORDS = [
    ("private_removed", ("Private video", "Video unavailable", "This video is unavailable", "removed by the uploader", "has not made this video available")),
    ("age_gate", ("age-restricted", "confirm your age", "This video is age-restricted", "This video may be inappropriate")),
    ("geo_block", ("not available in your country", "not available in this country", "Playback restricted", "playback on other applications")),
    ("members_only", ("members-only", "available to members", "members only")),
    ("livestream", ("is a live stream", "live stream", "This live event", "a live event that is currently live")),
    ("rate_limited", ("Too many requests", "HTTP Error 429", "429")),
    ("bot_check", ("Sign in to confirm you're not a bot", "confirm you're not a bot", "YouTube is not responding")),
    ("forbidden", ("HTTP Error 403", "403", "not be able to be played")),
    ("unsupported", ("Unsupported URL", "not a valid URL", "unsupported site")),
]

def classify_error(error: Exception) -> str:
    message = str(error)
    for code, keywords in ERROR_KEYWORDS:
        for kw in keywords:
            if kw.lower() in message.lower():
                return code
    return "unknown"

HARD_ERRORS = {"private_removed", "age_gate", "geo_block", "members_only", "livestream", "unsupported"}

ERROR_MESSAGES = {
    "private_removed": "Vídeo removido ou indisponível.",
    "age_gate": "Vídeo com restrição de idade (age-gate).",
    "geo_block": "Vídeo bloqueado para a sua região.",
    "members_only": "Vídeo exclusivo para membros do canal.",
    "livestream": "Este é um vídeo ao vivo; não dá para reproduzir agora.",
    "rate_limited": "Limite de requisições ao YouTube atingido. Tente novamente em instantes.",
    "bot_check": "O YouTube pediu confirmação de bot (Sign in to confirm). Tente de novo em alguns minutos.",
    "forbidden": "Acesso negado pelo YouTube (403). Tente de novo em instantes.",
    "unsupported": "Link do YouTube não reconhecido.",
    "unknown": "Falha ao extrair o vídeo.",
}

# ---------------------------------------------------------------------------
# Extração e Cache via yt-dlp
# ---------------------------------------------------------------------------
def extract_with_ytdlp(url: str, video_id: str) -> dict:
    json_path = os.path.join(DOWNLOADS_DIR, f"{video_id}.info.json")
    
    # 1. Verifica se já existe em disco
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                info = json.load(f)
            
            ext = info.get("ext", "mp4")
            local_url = f"https://comunaradio.duckdns.org/media/{video_id}.{ext}"
            info["url"] = local_url
            
            # Toca no atime de todos os arquivos relacionados para o LRU não apagar
            for mf in glob.glob(os.path.join(DOWNLOADS_DIR, f"{video_id}.*")):
                os.utime(mf, None)
                
            return info
        except Exception as e:
            logging.warning("Erro ao ler JSON de cache %s: %s", json_path, e)
            # Se falhou, segue para o download

    # 2. Não existe em cache, faz o download do vídeo em até 360p com áudio
    opts = {
        "format": "best[height<=360]/bestaudio/best",
        "outtmpl": os.path.join(DOWNLOADS_DIR, "%(id)s.%(ext)s"),
        "writeinfojson": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "extractor_args": {},
    }
    
    attempts = [
        (None, True),
        (("tv_embedded",), True),
        (None, False),
    ]
    last_error: Optional[Exception] = None
    for clients, use_pot in attempts:
        try:
            if clients:
                opts["extractor_args"]["youtube"] = {"player_client": list(clients)}
            if use_pot:
                opts["extractor_args"]["youtubepot-bgutilhttp"] = {"base_url": [POT_BASE_URL]}
            
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                ext = info.get("ext", "mp4")
                info["url"] = f"https://comunaradio.duckdns.org/media/{info['id']}.{ext}"
                return info
        except Exception as e:
            last_error = e
            code = classify_error(e)
            if code not in ("bot_check", "forbidden", "unknown"):
                raise
    if last_error is None:
        raise RuntimeError("Falha desconhecida ao extrair")
    raise last_error

# ---------------------------------------------------------------------------
# Fallbacks e Endpoints
# ---------------------------------------------------------------------------
def extract_with_piped(video_id: str) -> Optional[dict]:
    for instance in PIPED_INSTANCES:
        instance = instance.strip()
        if not instance:
            continue
        try:
            url = f"https://{instance}/streams/{video_id}"
            resp = httpx.get(url, timeout=12)
            resp.raise_for_status()
            data = resp.json()
            audio_streams = data.get("audioStreams", [])
            if not audio_streams:
                continue
            best_audio = audio_streams[-1]
            return {
                "id": video_id,
                "titulo": data.get("title", "Faixa via Piped"),
                "thumbnail_url": data.get("thumbnailUrl"),
                "duracao_seg": data.get("duration"),
                "audio_url": best_audio.get("url"),
                "video_url": best_audio.get("url"),
                "source": "piped",
            }
        except Exception as e:
            logging.warning("Piped %s falhou: %s", instance, e)
    return None

def demo_payload(video_id: str) -> dict:
    return {
        "id": video_id,
        "titulo": "Faixa de Demonstração (Extração Bloqueada)",
        "thumbnail_url": "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=320",
        "duracao_seg": 180,
        "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        "video_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        "source": "demo",
        "fallback": True,
    }

def error_response(code: str, message: str):
    return JSONResponse(status_code=422, content={"error": {"code": code, "message": message}})

@app.post("/extract")
def extract_url(req: ExtractRequest):
    video_id = get_video_id(req.url)
    if not video_id:
        return error_response("unsupported", ERROR_MESSAGES["unsupported"])

    try:
        info = extract_with_ytdlp(req.url, video_id)
        local_url = info.get("url")
        payload = {
            "id": info.get("id") or video_id,
            "titulo": info.get("title"),
            "thumbnail_url": info.get("thumbnail"),
            "duracao_seg": info.get("duration"),
            "audio_url": local_url,
            "audio_ext": info.get("ext") or "mp4",
            "video_url": local_url,
            "original_url": req.url,
            "source": "yt-dlp-cached",
        }
    except Exception as e:
        code = classify_error(e)
        logging.warning("yt-dlp falhou para %s (%s): %s", req.url, code, e)
        if code in HARD_ERRORS:
            return error_response(code, ERROR_MESSAGES[code])

        piped = extract_with_piped(video_id)
        if piped:
            piped["original_url"] = req.url
            payload = piped
        else:
            payload = demo_payload(video_id)

    return payload

@app.get("/health")
def health():
    return {"status": "ok"}
