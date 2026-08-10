import os
import re
import time
import json
import glob
import logging
import asyncio
from collections import deque
from typing import Optional
from urllib.parse import urlparse

import httpx
import yt_dlp
from fastapi import FastAPI, Depends, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

app = FastAPI(title="Radio Video Extractor")

# Mesma allowlist do backend (api/src/server.ts) -- ajuste os dois juntos se
# o dominio do frontend mudar.
ALLOWED_ORIGINS = [
    "https://radio-video-chi.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# O extrator fica atras do Caddy (proxy reverso via rede interna do Docker),
# entao request.client.host seria sempre o IP do Caddy, nao do usuario real.
# Le o X-Forwarded-For que o Caddy ja preenche por padrao.
def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

limiter = Limiter(key_func=get_client_ip)
app.state.limiter = limiter

# Handler customizado (em vez do padrao do slowapi) pra manter o mesmo
# formato {"error": {"code", "message"}} que o resto do extrator usa --
# o frontend ja sabe mostrar uma mensagem especifica pro codigo rate_limited.
def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return error_response("rate_limited", ERROR_MESSAGES["rate_limited"], status_code=429)

app.add_exception_handler(RateLimitExceeded, rate_limit_handler)

VIDEO_ID_RE = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})")

YOUTUBE_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "music.youtube.com", "youtu.be", "www.youtu.be",
}

def is_youtube_url(url: str) -> bool:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return False
    return host.lower() in YOUTUBE_HOSTS

POT_BASE_URL = os.environ.get("POT_BASE_URL", "http://host.docker.internal:4416")
PIPED_INSTANCES = os.environ.get(
    "PIPED_INSTANCES",
    "pipedapi.smnz.de,api.piped.private.coffee,pipedapi.adminforge.de",
).split(",")

DOWNLOADS_DIR = "/app/downloads"
MAX_CACHE_BYTES = 15 * 1024 * 1024 * 1024  # 15 GB

if not os.path.exists(DOWNLOADS_DIR):
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# ── Log ring buffer + token de admin ─────────────────────────────────────────
# O backend (api) consulta /admin/logs e /extract/meta passando X-Admin-Token.
# Mesmo valor vem de ${EXTRACTOR_ADMIN_TOKEN} no docker-compose.
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

LOG_RING: deque = deque(maxlen=1000)


class RingBufferHandler(logging.Handler):
    def emit(self, record):
        try:
            LOG_RING.append(
                {
                    "ts": int(record.created * 1000),
                    "level": record.levelname.lower(),
                    "msg": self.format(record),
                }
            )
        except Exception:
            pass


logging.getLogger().addHandler(RingBufferHandler())


def require_admin_token(x_admin_token: str = Header(default="")):
    if not ADMIN_TOKEN or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="unauthorized")


class MetaRequest(BaseModel):
    url: str

class ExtractRequest(BaseModel):
    url: str
    quality: str = "360p"

# Qualidades suportadas no seletor do app. Cada uma tem o formato yt-dlp e um
# sufixo de arquivo; 360p usa os nomes legados ({id}.mp4) pra nao quebrar os
# arquivos ja baixados. 144p e audio usam sufixo ({id}.144.mp4, {id}.audio.m4a)
# pra coexistirem em disco sem sobrescrever uns aos outros.
QUALITY_OPTS = {
    "360p": {"format": "best[height<=360]/bestaudio/best", "suffix": ""},
    "144p": {"format": "best[height<=144]/bestaudio/best", "suffix": ".144"},
    "audio": {"format": "bestaudio/best", "suffix": ".audio"},
}

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
    "invalid_quality": "Qualidade inválida. Escolha 360p, 144p ou áudio.",
    "unknown": "Falha ao extrair o vídeo.",
}

# ---------------------------------------------------------------------------
# Extração e Cache via yt-dlp
# ---------------------------------------------------------------------------
def extract_with_ytdlp(url: str, video_id: str, quality: str = "360p") -> dict:
    opts_q = QUALITY_OPTS.get(quality) or QUALITY_OPTS["360p"]
    suffix = opts_q["suffix"]
    json_path = os.path.join(DOWNLOADS_DIR, f"{video_id}{suffix}.info.json")
    
    # 1. Verifica se já existe em disco
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                info = json.load(f)
            
            ext = info.get("ext", "mp4")
            local_url = f"https://comunaradio.duckdns.org/media/{video_id}{suffix}.{ext}"
            info["url"] = local_url
            
            # Toca no atime de todos os arquivos relacionados para o LRU não apagar
            for mf in glob.glob(os.path.join(DOWNLOADS_DIR, f"{video_id}.*")):
                os.utime(mf, None)
                
            return info
        except Exception as e:
            logging.warning("Erro ao ler JSON de cache %s: %s", json_path, e)
            # Se falhou, segue para o download

    # 2. Não existe em cache, faz o download na qualidade escolhida
    opts = {
        "format": opts_q["format"],
        "outtmpl": os.path.join(DOWNLOADS_DIR, f"%(id)s{suffix}.%(ext)s"),
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
                info["url"] = f"https://comunaradio.duckdns.org/media/{info['id']}{suffix}.{ext}"
                return info
        except Exception as e:
            last_error = e
            code = classify_error(e)
            if code not in ("bot_check", "forbidden", "unknown"):
                raise
    if last_error is None:
        raise RuntimeError("Falha desconhecida ao extrair")
    raise last_error

def extract_metadata(url: str, video_id: str) -> dict:
    """Resolve apenas os metadados do vídeo via yt-dlp, sem baixar nada."""
    opts = {
        "skip_download": True,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
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
                info = ydl.extract_info(url, download=False)
                return {
                    "id": info.get("id") or video_id,
                    "titulo": info.get("title"),
                    "thumbnail_url": info.get("thumbnail"),
                    "duracao_seg": info.get("duration"),
                    "is_live": info.get("is_live") or False,
                    "uploader": info.get("uploader"),
                }
        except Exception as e:
            last_error = e
            code = classify_error(e)
            if code not in ("bot_check", "forbidden", "unknown"):
                raise
    if last_error is None:
        raise RuntimeError("Falha desconhecida ao extrair metadados")
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

def error_response(code: str, message: str, status_code: int = 422):
    return JSONResponse(status_code=status_code, content={"error": {"code": code, "message": message}})

@app.post("/extract")
@limiter.limit("15/minute")
def extract_url(request: Request, req: ExtractRequest):
    if not is_youtube_url(req.url):
        return error_response("unsupported", ERROR_MESSAGES["unsupported"])

    video_id = get_video_id(req.url)
    if not video_id:
        return error_response("unsupported", ERROR_MESSAGES["unsupported"])

    if req.quality not in QUALITY_OPTS:
        return error_response("invalid_quality", ERROR_MESSAGES["invalid_quality"])

    try:
        info = extract_with_ytdlp(req.url, video_id, req.quality)
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
            "quality": req.quality,
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

@app.get("/admin/logs")
@limiter.limit("30/minute")
def admin_logs(request: Request, limit: int = 200, _: str = Depends(require_admin_token)):
    return {"logs": list(LOG_RING)[-limit:]}

@app.post("/extract/meta")
@limiter.limit("10/minute")
def extract_meta(request: Request, req: MetaRequest, _: str = Depends(require_admin_token)):
    if not is_youtube_url(req.url):
        return error_response("unsupported", ERROR_MESSAGES["unsupported"])

    video_id = get_video_id(req.url)
    if not video_id:
        return error_response("unsupported", ERROR_MESSAGES["unsupported"])

    try:
        return extract_metadata(req.url, video_id)
    except Exception as e:
        code = classify_error(e)
        logging.warning("Meta extraction falhou para %s (%s): %s", req.url, code, e)
        return error_response(code, ERROR_MESSAGES.get(code, ERROR_MESSAGES["unknown"]))
