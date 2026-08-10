const BACKEND_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : 'http://127.0.0.1:3005';
const TOKEN_KEY = 'radio-video-admin-token';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function getAdminToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setAdminToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}
export function clearAdminToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getAdminToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const res = await fetch(`${BACKEND_URL}/admin${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 401) {
      clearAdminToken();
      throw new ApiError('unauthorized', 'Sessão expirada. Faça login novamente.', 401);
    }
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try {
        const data = await res.json();
        msg = data?.error?.message || msg;
      } catch {
        /* corpo não-JSON */
      }
      throw new ApiError('request_failed', msg, res.status);
    }
    return (await res.json()) as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new ApiError('timeout', 'A requisição demorou demais.', 0);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Baixa o backup de rooms.json com o header de autorização.
export async function downloadBackup(): Promise<void> {
  const token = getAdminToken();
  const res = await fetch(`${BACKEND_URL}/admin/backup`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rooms-backup-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface Overview {
  roomsActive: number;
  roomsTotal: number;
  roomsPlaying: number;
  roomsPaused: number;
  tracksLibrary: number;
  roomTracks: number;
  usersTotal: number;
  pushSubscriptions: number;
  pushSubscriptionsInMemory: number;
  media: { count: number; totalBytes: number; orphanBytes: number };
  vm: VmMetrics;
}

export interface VmMetrics {
  uptimeSec: number | null;
  loadAvg: number[] | null;
  memTotal: number | null;
  memFree: number | null;
  memAvailable: number | null;
  disk: Array<{ mount: string; total: number; used: number; avail: number; usePct: number }>;
  nodeVersion: string;
  processUptimeSec: number;
  platform: string;
}

export interface TableInfo {
  name: string;
  count: number;
}

export interface TableDetail {
  name: string;
  count: number;
  rows: Array<Record<string, unknown>>;
  columns: string[];
}

export interface LibraryTrack {
  youtube_id: string;
  titulo: string;
  duracao_seg: number;
  thumbnail_url?: string;
  audio_url?: string;
  video_url?: string;
  created_at?: string;
  references: number;
}

export interface AdminUser {
  id: string;
  name: string;
  createdAt: string | null;
  favoritesCount: number;
  pushSubscriptions: number;
}

export interface PushSub {
  endpoint: string;
  userId: string;
  p256dh?: string;
  auth?: string;
  createdAt?: string | null;
}

export interface AdminRoom {
  id: string;
  name: string;
  codigo_convite: string;
  active: boolean;
  usersCount: number;
  radialistaName: string | null;
  queueCount: number;
  historyCount: number;
  favoritesCount: number;
  playbackStatus: 'playing' | 'paused' | null;
  playingTrack: string | null;
  users: Array<{ id: string; name: string }>;
}

export interface RoomDetail {
  id: string;
  name: string;
  codigo_convite: string;
  radialista_id: string | null;
  playback: { status: string; currentTrackId: string | null; timestamp: number; updated_at: number };
  pausedForEmptyRoom: boolean;
  users: Array<{ id: string; name: string; socket_id: string; entrou_em: number }>;
  queue: Array<Record<string, unknown> & { id: string; titulo: string; youtube_video_id: string; duracao_seg: number }>;
  history: Array<Record<string, unknown> & { id: string; titulo: string; youtube_video_id: string }>;
  chat: Array<Record<string, unknown>>;
}

export interface MediaFile {
  name: string;
  sizeBytes: number;
  mtime: number;
  youtubeId: string;
  title: string | null;
  isInfoJson: boolean;
  quality: string | null;
  inUse: boolean;
}

export interface MediaResponse {
  files: MediaFile[];
  totalBytes: number;
  orphanBytes: number;
  count: number;
  storage: {
    byFormat: Array<{ ext: string; size: number; count: number }>;
    top10: Array<{ name: string; sizeBytes: number; inUse: boolean }>;
  };
}

export interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface ActivityEntry {
  id: string;
  ts: number;
  type: string;
  actor?: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

export const adminApi = {
  login: (username: string, password: string) =>
    request<{ token: string; expiresAt: number }>('/login', { method: 'POST', body: { username, password }, timeoutMs: 10000 }),
  logout: () => request('/logout', { method: 'POST' }),
  overview: () => request<Overview>('/overview'),
  tables: () => request<{ tables: TableInfo[] }>('/tables'),
  table: (name: string) => request<TableDetail>(`/tables/${encodeURIComponent(name)}`),
  library: (q?: string) =>
    request<{ tracks: LibraryTrack[] }>(`/library${q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
  updateTrack: (youtubeId: string, patch: { titulo?: string; duracao_seg?: number }) =>
    request(`/library/${encodeURIComponent(youtubeId)}`, { method: 'PUT', body: patch }),
  deleteTrack: (youtubeId: string) =>
    request(`/library/${encodeURIComponent(youtubeId)}`, { method: 'DELETE', body: { confirm: true } }),
  users: () => request<{ users: AdminUser[] }>('/users'),
  deleteUser: (id: string) => request(`/users/${encodeURIComponent(id)}`, { method: 'DELETE', body: { confirm: true } }),
  pushSubscriptions: () => request<{ subscriptions: PushSub[]; inMemory: number }>('/push-subscriptions'),
  clearOrphanSubs: () =>
    request<{ removed: number }>('/push-subscriptions/orphans', { method: 'DELETE', body: { confirm: true } }),
  sendTestPush: (title: string, body: string) =>
    request<{ sent: number }>('/push/test', { method: 'POST', body: { title, body } }),
  rooms: () => request<{ rooms: AdminRoom[] }>('/rooms'),
  roomDetail: (id: string) => request<RoomDetail>(`/rooms/${encodeURIComponent(id)}`),
  updateRoom: (id: string, patch: { name?: string; codigo_convite?: string }) =>
    request(`/rooms/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }),
  deleteRoom: (id: string) => request(`/rooms/${encodeURIComponent(id)}`, { method: 'DELETE', body: { confirm: true } }),
  addTrackToRoom: (id: string, youtubeId: string) =>
    request(`/rooms/${encodeURIComponent(id)}/tracks`, { method: 'POST', body: { youtubeId } }),
  removeTrackFromRoom: (id: string, trackId: string) =>
    request(`/rooms/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
      body: { confirm: true },
    }),
  media: () => request<MediaResponse>('/media'),
  deleteMedia: (name: string) =>
    request(`/media/${encodeURIComponent(name)}`, { method: 'DELETE', body: { confirm: true } }),
  logs: (lines = 200) => request<{ logs: LogEntry[] }>(`/logs?lines=${lines}`),
  activity: (limit = 100) => request<{ activity: ActivityEntry[] }>(`/activity?limit=${limit}`),
  vm: () => request<{ vm: VmMetrics }>('/vm'),
  refresh: () => request<{ status: string; rooms: number }>('/refresh', { method: 'POST' }),
  extractorHealth: () => request<{ status: number; body: unknown }>('/extractor/health'),
  extractorLogs: () => request<{ status: number; body: { logs: LogEntry[] } }>('/extractor/logs'),
  extractorMeta: (url: string) =>
    request<{ status: number; body: any }>('/extractor/meta', { method: 'POST', body: { url }, timeoutMs: 30000 }),
};
