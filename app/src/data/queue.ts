import type { Track, TrackPreview } from './types';
import { subscribe, notify } from './pubsub';

const queueByRoom = new Map<string, Track[]>();

const subKey = (roomId: string) => `queue:${roomId}`;

export function applyQueue(roomId: string, tracks: Track[]): void {
  queueByRoom.set(roomId, [...tracks]);
  notify(subKey(roomId));
}

export function subscribeQueue(roomId: string, cb: () => void): () => void {
  return subscribe(subKey(roomId), cb);
}

export function getQueue(roomId: string): Track[] {
  if (!queueByRoom.has(roomId)) {
    queueByRoom.set(roomId, []);
  }
  return queueByRoom.get(roomId)!;
}

export function addTrack(roomId: string, track: Omit<Track, 'id'>): Track {
  const newTrack: Track = {
    ...track,
    id: Math.random().toString(36).slice(2, 11),
  };
  getQueue(roomId).push(newTrack);
  notify(subKey(roomId));
  return newTrack;
}

export function clearQueue(roomId: string): void {
  queueByRoom.delete(roomId);
}

const EXTRACTOR_URL = 'http://127.0.0.1:8000/extract';

const EXTRACTOR_ERRORS: Record<string, string> = {
  private_removed: 'Vídeo removido ou indisponível.',
  age_gate: 'Vídeo com restrição de idade.',
  geo_block: 'Vídeo bloqueado para a sua região.',
  members_only: 'Vídeo exclusivo para membros do canal.',
  livestream: 'Este é um vídeo ao vivo; não dá para reproduzir.',
  rate_limited: 'Limite de requisições ao YouTube atingido. Tente de novo em instantes.',
  bot_check: 'O YouTube pediu confirmação de bot. Tente de novo em alguns minutos.',
  forbidden: 'Acesso negado pelo YouTube (403). Tente de novo em instantes.',
  unsupported: 'Link do YouTube não reconhecido.',
  unknown: 'Falha ao extrair o vídeo.',
};

function demoPreview(url: string): TrackPreview {
  const videoId =
    url.split('v=')[1]?.split('&')[0] ??
    url.split('youtu.be/')[1]?.split('?')[0] ??
    Math.random().toString(36).slice(2, 13);
  return {
    id: videoId,
    titulo: 'Faixa de Demonstração (preview fake)',
    thumbnail_url: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=320',
    duracao_seg: 180,
    audio_url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  };
}

export async function previewTrack(url: string): Promise<TrackPreview> {
  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    res = await fetch(EXTRACTOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return demoPreview(url);
  }

  if (res.ok) {
    const data = await res.json();
    if (!data || !data.audio_url) throw new Error('Extractor sem audio_url');
    return {
      id: data.id,
      titulo: data.titulo,
      thumbnail_url: data.thumbnail_url,
      duracao_seg: data.duracao_seg,
      audio_url: data.audio_url,
    };
  }

  const body = await res.json().catch(() => null);
  const code = body?.error?.code ?? 'unknown';
  throw new Error(EXTRACTOR_ERRORS[code] ?? body?.error?.message ?? 'Falha ao extrair o vídeo.');
}
