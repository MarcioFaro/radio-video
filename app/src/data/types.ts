export interface User {
  id: string;
  name: string;
  avatar_url?: string;
}

export interface Room {
  id: string;
  name: string;
  owner_id: string;
  codigo_convite: string;
  criado_em: string;
}

export interface Track {
  id: string;
  youtube_video_id: string;
  titulo: string;
  thumbnail_url: string;
  duracao_seg: number;
  audio_url?: string;
  adicionado_por: string;
}

export interface TrackPreview {
  id: string;
  titulo: string;
  thumbnail_url: string;
  duracao_seg: number;
  audio_url: string;
}

export interface ChatMessage {
  id: string;
  user_name: string;
  texto: string;
  timestamp: number;
}

export interface PlaybackState {
  status: 'playing' | 'paused';
  currentTrackId: string | null;
  timestamp: number;
}
