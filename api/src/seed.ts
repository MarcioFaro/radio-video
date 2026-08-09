export const SEEDED_ROOM_ID = 'comuna-roots';
export const SEEDED_ROOM_NAME = 'Comuna Radio Roots';
export const SEEDED_ROOM_CODE = 'ROOTS25';

export interface SeedSong {
  youtube_video_id: string;
  titulo: string;
  duracao_seg: number;
}

export const SEEDED_SONGS: SeedSong[] = [
  {
    youtube_video_id: 'aXIDAd68ThI',
    titulo: 'Bob Marley Tuff Gong Studio Rehearsal 1980 Full session',
    duracao_seg: 2278,
  },
  {
    youtube_video_id: 'i6cRXFs6BzI',
    titulo: 'BOB MARLEY Live in Santa Barbara 1979 FULL CONCERT',
    duracao_seg: 5536,
  },
];
