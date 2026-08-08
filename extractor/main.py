from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import yt_dlp
import logging
import httpx
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Radio Video Extractor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ExtractRequest(BaseModel):
    url: str

def extract_with_piped(video_id: str):
    # Fallback usando a API pública do Piped (instância smnz.de)
    try:
        url = f"https://pipedapi.smnz.de/streams/{video_id}"
        resp = httpx.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        
        # Pega a melhor stream de áudio
        audio_streams = data.get("audioStreams", [])
        if not audio_streams:
            raise Exception("Nenhuma stream de áudio encontrada no Piped")
            
        best_audio = audio_streams[-1] # Geralmente as últimas são de melhor qualidade (m4a/opus)
        
        return {
            "id": video_id,
            "titulo": data.get("title", "Faixa via Piped"),
            "thumbnail_url": data.get("thumbnailUrl"),
            "duracao_seg": data.get("duration"),
            "audio_url": best_audio.get("url"),
            "original_url": f"https://youtube.com/watch?v={video_id}"
        }
    except Exception as e:
        logging.error(f"Piped fallback failed: {e}")
        raise e

@app.post("/extract")
async def extract_url(req: ExtractRequest):
    # Extract ID
    video_id = req.url.split("v=")[-1].split("&")[0]
    if "youtu.be/" in req.url:
        video_id = req.url.split("youtu.be/")[-1].split("?")[0]
        
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {'youtube': {'player_client': ['ios', 'tv']}},
    }
    
    try:
        # Tenta yt-dlp primeiro
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(req.url, download=False)
            return {
                "id": info.get("id"),
                "titulo": info.get("title"),
                "thumbnail_url": info.get("thumbnail"),
                "duracao_seg": info.get("duration"),
                "audio_url": info.get("url"), 
                "original_url": req.url
            }
    except Exception as e:
        logging.warning(f"yt-dlp falhou para {req.url}. Tentando fallback Piped... Erro original: {str(e)}")
        # Fallback
        try:
            return extract_with_piped(video_id)
        except Exception as fallback_error:
            logging.error(f"Piped fallback failed: {fallback_error}")
            # ULTIMATE FALLBACK para fins de protótipo (para a interface não quebrar)
            return {
                "id": video_id,
                "titulo": "Faixa de Demonstração (Extração Bloqueada)",
                "thumbnail_url": "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=320",
                "duracao_seg": 180,
                "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                "original_url": req.url
            }

@app.get("/health")
def health():
    return {"status": "ok"}
