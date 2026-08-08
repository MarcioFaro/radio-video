import type { Track, TrackPreview } from './types';

const queueByRoom = new Map<string, Track[]>();

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
  return newTrack;
}

export function clearQueue(roomId: string): void {
  queueByRoom.delete(roomId);
}

export async function previewTrack(url: string): Promise<TrackPreview> {
  await new Promise((resolve) => setTimeout(resolve, 600));
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
