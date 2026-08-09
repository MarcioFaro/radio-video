import os
import re
import time
import logging
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

# Servidor POT (PoToken) — container bgutil-ytdlp-pot-provider, porta 4416.
# Dentro do Docker, "host.docker.internal" aponta para o host.
POT_BASE_URL = os.environ.get("POT_BASE_URL", "http://host.docker.internal:4416")

# Instâncias públicas do Piped como fallback best-effort.
PIPED_INSTANCES = os.environ.get(
    "PIPED_INSTANCES",
    "pipedapi.smnz.de,api.piped.private.coffee,pipedapi.adminforge.de",
).split(",")

CACHE_TTL_SEC = 600  # URLs de stream expiram; cache curto em memória

_cache: dict[str, tuple[float, dict]] = {}


class ExtractRequest(BaseModel):
    url: str


def get_video_id(url: str) -> Optional[str]:
    match = VIDEO_ID_RE.search(url)
    return match.group(1) if match else None


# ---------------------------------------------------------------------------
# Classificação de erros do yt-dlp -> código estruturado
# ---------------------------------------------------------------------------

ERROR_KEYWORDS = [
    ("private_removed", (
        "Private video",
        "Video unavailable",
        "This video is unavailable",
        "removed by the uploader",
        "has not made this video available",
    )),
    ("age_gate", (
        "age-restricted",
        "confirm your age",
        "This video is age-restricted",
        "This video may be inappropriate",
    )),
    ("geo_block", (
        "not available in your country",
        "not available in this country",
        "Playback restricted",
        "playback on other applications",
    )),
    ("members_only", (
        "members-only",
        "available to members",
        "members only",
    )),
    ("livestream", (
        "is a live stream",
        "live stream",
        "This live event",
        "a live event that is currently live",
    )),
    ("rate_limited", (
        "Too many requests",
        "HTTP Error 429",
        "429",
    )),
    ("bot_check", (
        "Sign in to confirm you're not a bot",
        "confirm you're not a bot",
        "YouTube is not responding",
    )),
    ("forbidden", (
        "HTTP Error 403",
        "403",
        "not be able to be played",
    )),
    ("unsupported", (
        "Unsupported URL",
        "not a valid URL",
        "unsupported site",
    )),
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
# Extração via yt-dlp (com PoToken)
# ---------------------------------------------------------------------------

def build_opts(player_clients: Optional[tuple[str, ...]], use_pot: bool) -> dict:
    opts = {
        "format": "bestaudio/best",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "extractor_args": {},
    }
    if player_clients:
        opts["extractor_args"]["youtube"] = {"player_client": list(player_clients)}
    if use_pot:
        opts["extractor_args"]["youtubepot-bgutilhttp"] = {"base_url": [POT_BASE_URL]}
    return opts


def extract_with_ytdlp(url: str) -> dict:
    # Clientes web/web_embedded retornam formats DRM-only (quebram a seleção),
    # então usamos o cliente padrão + PoToken. Fallbacks: tv_embedded + PoToken,
    # e depois cliente padrão sem PoToken (caso o servidor POT esteja fora).
    attempts = [
        (None, True),
        (("tv_embedded",), True),
        (None, False),
    ]
    last_error: Optional[Exception] = None
    for clients, use_pot in attempts:
        try:
            with yt_dlp.YoutubeDL(build_opts(clients, use_pot)) as ydl:
                return ydl.extract_info(url, download=False)
        except Exception as e:  # noqa: BLE001 - yt-dlp lança DownloadError/ExtractorError
            last_error = e
            code = classify_error(e)
            if code not in ("bot_check", "forbidden", "unknown"):
                raise
    if last_error is None:
        raise RuntimeError("Falha desconhecida ao extrair")
    raise last_error


def best_video_url(info: dict) -> Optional[str]:
    # Rádio é focada em som: o vídeo é secundário (minimap/visual) → menor
    # resolução possível. Prefere progressivo (vídeo + áudio) para tocar com som;
    # sem progressivo, cai para o video-only de menor resolução.
    progressive = None
    video_only = None
    for f in info.get("formats", []):
        vcodec = f.get("vcodec")
        height = f.get("height") or 0
        if not vcodec or vcodec == "none" or not f.get("url") or height <= 0:
            continue
        acodec = f.get("acodec")
        has_audio = bool(acodec) and acodec != "none"
        target = progressive if has_audio else video_only
        if target is None or height < target[0]:
            target = (height, f["url"])
        if has_audio:
            progressive = target
        else:
            video_only = target
    best = progressive or video_only
    return best[1] if best else None


# ---------------------------------------------------------------------------
# Fallback Piped (best-effort)
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
                "video_url": None,
                "source": "piped",
            }
        except Exception as e:  # noqa: BLE001 - qualquer instância pode cair
            logging.warning("Piped %s falhou: %s", instance, e)
    return None


def demo_payload(video_id: str) -> dict:
    return {
        "id": video_id,
        "titulo": "Faixa de Demonstração (Extração Bloqueada)",
        "thumbnail_url": "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=320",
        "duracao_seg": 180,
        "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        "video_url": None,
        "source": "demo",
        "fallback": True,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def error_response(code: str, message: str):
    return JSONResponse(status_code=422, content={"error": {"code": code, "message": message}})


@app.post("/extract")
def extract_url(req: ExtractRequest):
    video_id = get_video_id(req.url)
    if not video_id:
        return error_response("unsupported", ERROR_MESSAGES["unsupported"])

    # Cache curto por video_id (URLs expiram)
    cached = _cache.get(video_id)
    if cached and (time.time() - cached[0]) < CACHE_TTL_SEC:
        return cached[1]

    try:
        info = extract_with_ytdlp(req.url)
        payload = {
            "id": info.get("id") or video_id,
            "titulo": info.get("title"),
            "thumbnail_url": info.get("thumbnail"),
            "duracao_seg": info.get("duration"),
            "audio_url": info.get("url"),
            "audio_ext": info.get("ext") or info.get("audio_ext"),
            "video_url": best_video_url(info),
            "original_url": req.url,
            "source": "yt-dlp",
        }
    except Exception as e:  # noqa: BLE001
        code = classify_error(e)
        logging.warning("yt-dlp falhou para %s (%s): %s", req.url, code, e)
        if code in HARD_ERRORS:
            return error_response(code, ERROR_MESSAGES[code])

        # Erro "mole" (bot/429/403/desconhecido) -> tenta Piped
        piped = extract_with_piped(video_id)
        if piped:
            piped["original_url"] = req.url
            payload = piped
        else:
            payload = demo_payload(video_id)

    _cache[video_id] = (time.time(), payload)
    return payload


@app.get("/health")
def health():
    return {"status": "ok"}
