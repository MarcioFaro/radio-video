import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  rooms,
  supabase,
  DATA_DIR,
  pushSubscriptions,
  loadRooms,
  deleteRoomCompletely,
  updateRoomInSupabase,
  deleteUserCompletely,
  deleteLibraryTrackByYoutubeId,
  updateLibraryTrack,
  addTrackToRoomQueue,
  removeTrackFromRoomQueue,
  serializeRoomsForBackup,
  Room,
} from './store';
import { getRecentLogs, log } from './logger';
import { getRecentActivity, recordActivity } from './activity';
import { sendPushToSubs } from './push';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// Se definida, o login admin exige usuário e senha. Se vazia, só a senha.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const SESSION_TTL_MS = (Number(process.env.ADMIN_SESSION_HOURS) || 24) * 60 * 60 * 1000;
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || '/downloads';
const EXTRACTOR_BASE = process.env.EXTRACTOR_BASE || 'http://extractor:8000';
const EXTRACTOR_ADMIN_TOKEN = process.env.EXTRACTOR_ADMIN_TOKEN || '';

const KNOWN_TABLES = ['rooms', 'tracks_library', 'room_tracks', 'users', 'user_favorite_rooms', 'push_subscriptions'];

// token -> expiresAt
const sessions = new Map<string, number>();

// Rate limit do login: 5 tentativas / 15 min por IP
const LOGIN_MAX = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; firstTs: number }>();

function clientIp(request: FastifyRequest): string {
  const fwd = request.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return request.ip || 'unknown';
}

function safeEqual(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function adminEnabled(): boolean {
  return !!ADMIN_PASSWORD;
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!adminEnabled()) {
    return reply.status(503).send({
      error: { code: 'admin_disabled', message: 'Central admin desabilitada (ADMIN_PASSWORD não definido).' },
    });
  }
  const auth = request.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (expiresAt) sessions.delete(token);
    return reply.status(401).send({
      error: { code: 'unauthorized', message: 'Sessão expirada ou inválida. Faça login novamente.' },
    });
  }
  return;
}

async function countTable(table: string): Promise<number> {
  if (!supabase) return 0;
  try {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function getVmMetrics() {
  const read = (p: string) => {
    try {
      return fs.readFileSync(p, 'utf-8');
    } catch {
      return null;
    }
  };
  const uptime = read('/proc/uptime');
  const loadavg = read('/proc/loadavg');
  const meminfo = read('/proc/meminfo');

  const parseMem = (key: string) => {
    if (!meminfo) return null;
    const m = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`));
    return m ? Number(m[1]) * 1024 : null;
  };

  let disk: Array<{ mount: string; total: number; used: number; avail: number; usePct: number }> = [];
  const targets = [DOWNLOADS_DIR, DATA_DIR].filter((d) => {
    try {
      return fs.existsSync(d);
    } catch {
      return false;
    }
  });
  if (targets.length > 0) {
    try {
      const { stdout } = await promisify(execFile)('df', ['-k', ...targets]);
      const lines = stdout.trim().split('\n').slice(1);
      disk = lines
        .map((line) => {
          const p = line.trim().split(/\s+/);
          if (p.length < 6) return null;
          return {
            mount: p[5],
            total: Number(p[1]) * 1024,
            used: Number(p[2]) * 1024,
            avail: Number(p[3]) * 1024,
            usePct: Number(p[4].replace('%', '')),
          };
        })
        .filter(Boolean) as Array<{ mount: string; total: number; used: number; avail: number; usePct: number }>;
    } catch {
      /* df indisponível no ambiente */
    }
  }

  return {
    uptimeSec: uptime ? Number(uptime.split(' ')[0]) : null,
    loadAvg: loadavg ? loadavg.split(' ').slice(0, 3).map(Number) : null,
    memTotal: parseMem('MemTotal'),
    memFree: parseMem('MemFree'),
    memAvailable: parseMem('MemAvailable'),
    disk,
    nodeVersion: process.version,
    processUptimeSec: Math.round(process.uptime()),
    platform: process.platform,
  };
}

async function listMediaFiles() {
  let libraryIds = new Set<string>();
  let queueIds = new Set<string>();
  const titles = new Map<string, string>();
  if (supabase) {
    const [lib, qt] = await Promise.all([
      supabase.from('tracks_library').select('youtube_id, titulo'),
      supabase.from('room_tracks').select('youtube_id'),
    ]);
    if (!lib.error) {
      for (const r of lib.data || []) {
        if (r.youtube_id) {
          libraryIds.add(r.youtube_id);
          if (r.titulo) titles.set(r.youtube_id, r.titulo);
        }
      }
    }
    if (!qt.error) queueIds = new Set((qt.data || []).map((r: any) => r.youtube_id));
  }

  const files: Array<{
    name: string;
    sizeBytes: number;
    mtime: number;
    youtubeId: string;
    title: string | null;
    isInfoJson: boolean;
    quality: string | null;
    inUse: boolean;
  }> = [];

  try {
    const names = fs.readdirSync(DOWNLOADS_DIR);
    for (const name of names) {
      if (name.endsWith('.info.json')) continue;
      const full = path.join(DOWNLOADS_DIR, name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const stem = name.replace(/\.[^.]+$/, '');
      const idMatch = name.match(/^([A-Za-z0-9_-]{11})/);
      const youtubeId = idMatch ? idMatch[1] : stem;
      let sizeBytes = stat.size;
      let quality: string | null = null;
      try {
        const ist = fs.statSync(path.join(DOWNLOADS_DIR, `${stem}.info.json`));
        if (ist.isFile()) sizeBytes += ist.size;
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(DOWNLOADS_DIR, `${stem}.info.json`), 'utf-8'));
          const h = raw.height;
          if (typeof h === 'number' && h > 0) {
            quality = `${h}p`;
          } else if (typeof raw.format_note === 'string' && raw.format_note) {
            quality = raw.format_note;
          }
        } catch {
          /* metadados ilegíveis */
        }
      } catch {
        /* sem arquivo de metadados do yt-dlp */
      }
      files.push({
        name,
        sizeBytes,
        mtime: stat.mtimeMs,
        youtubeId,
        title: titles.get(youtubeId) || null,
        isInfoJson: false,
        quality,
        inUse: libraryIds.has(youtubeId) || queueIds.has(youtubeId),
      });
    }
  } catch {
    /* diretório não existe */
  }

  const totalBytes = files.reduce((s, f) => s + f.sizeBytes, 0);
  const orphanBytes = files.filter((f) => !f.inUse).reduce((s, f) => s + f.sizeBytes, 0);
  files.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return { files, totalBytes, orphanBytes, count: files.length };
}

function storageAnalysis(files: Awaited<ReturnType<typeof listMediaFiles>>['files']) {
  const byExt = new Map<string, number>();
  for (const f of files) {
    const ext = path.extname(f.name).slice(1) || 'sem-ext';
    byExt.set(ext, (byExt.get(ext) || 0) + f.sizeBytes);
  }
  const byFormat = Array.from(byExt.entries()).map(([ext, size]) => ({
    ext,
    size,
    count: files.filter((f) => (path.extname(f.name).slice(1) || 'sem-ext') === ext).length,
  }));
  const top10 = files.slice(0, 10).map((f) => ({ name: f.name, sizeBytes: f.sizeBytes, inUse: f.inUse }));
  return { byFormat, top10 };
}

async function listRooms() {
  let dbRooms: any[] = [];
  if (supabase) {
    const { data } = await supabase.from('rooms').select('*');
    dbRooms = data || [];
  }
  const dbIds = new Set<string>(dbRooms.map((r) => r.id));

  const favoritesCount = new Map<string, number>();
  const queueCount = new Map<string, number>();
  if (supabase) {
    const [fav, rt] = await Promise.all([
      supabase.from('user_favorite_rooms').select('room_id'),
      supabase.from('room_tracks').select('room_id').eq('status', 'fila'),
    ]);
    for (const r of fav.data || []) favoritesCount.set(r.room_id, (favoritesCount.get(r.room_id) || 0) + 1);
    for (const r of rt.data || []) queueCount.set(r.room_id, (queueCount.get(r.room_id) || 0) + 1);
  }

  const roomToRow = (room: Room, inDb: boolean) => {
    const radialista = room.radialista_id
      ? Array.from(room.users.values()).find((u) => u.id === room.radialista_id)
      : null;
    const current = room.queue.find((t) => t.id === room.playback.currentTrackId);
    return {
      id: room.id,
      name: room.name,
      codigo_convite: room.codigo_convite || '',
      inDb,
      active: true,
      usersCount: room.users.size,
      radialistaName: radialista ? radialista.name : null,
      queueCount: room.queue.length,
      historyCount: room.history.length,
      favoritesCount: favoritesCount.get(room.id) || 0,
      playbackStatus: room.playback.status,
      playingTrack: current?.titulo ?? null,
      users: Array.from(room.users.values()).map((u) => ({ id: u.id, name: u.name })),
    };
  };

  const merged = dbRooms.map((r) => {
    const active = rooms.get(r.id);
    if (!active) {
      return {
        id: r.id,
        name: r.name,
        codigo_convite: r.codigo_convite || '',
        inDb: true,
        active: false,
        usersCount: 0,
        radialistaName: null,
        queueCount: queueCount.get(r.id) ?? 0,
        historyCount: 0,
        favoritesCount: favoritesCount.get(r.id) || 0,
        playbackStatus: null,
        playingTrack: null,
        users: [],
      };
    }
    return roomToRow(active, true);
  });

  // Salas que só existem em memória (foram excluídas do Supabase fora do admin,
  // ex.: direto no banco) também entram na listagem — sem isso ficam "órfãs"
  // invisíveis no admin mas continuam aparecendo na home, que lê a memória.
  for (const room of rooms.values()) {
    if (!dbIds.has(room.id)) {
      merged.push(roomToRow(room, false));
    }
  }

  merged.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  return merged;
}

async function listUsers() {
  if (!supabase) return { users: [] };
  const [usersRes, favs, subs] = await Promise.all([
    supabase.from('users').select('*').limit(2000),
    supabase.from('user_favorite_rooms').select('user_id, room_id'),
    supabase.from('push_subscriptions').select('user_id'),
  ]);
  const favCount = new Map<string, number>();
  const subCount = new Map<string, number>();
  for (const f of favs.data || []) favCount.set(f.user_id, (favCount.get(f.user_id) || 0) + 1);
  for (const s of subs.data || []) subCount.set(s.user_id, (subCount.get(s.user_id) || 0) + 1);
  const users = (usersRes.data || []).map((u: any) => ({
    id: u.id,
    name: u.name,
    createdAt: u.criado_em || u.created_at || null,
    favoritesCount: favCount.get(u.id) || 0,
    pushSubscriptions: subCount.get(u.id) || 0,
  }));
  return { users };
}

async function listPushSubscriptions() {
  if (!supabase) {
    return { subscriptions: pushSubscriptions.map((s) => ({ endpoint: s.endpoint, userId: s.userId })), inMemory: pushSubscriptions.length };
  }
  const { data } = await supabase.from('push_subscriptions').select('*').limit(2000);
  const subscriptions = (data || []).map((s: any) => ({
    endpoint: s.endpoint,
    userId: s.user_id,
    p256dh: s.p256dh,
    auth: s.auth,
    createdAt: s.criado_em || s.created_at || null,
  }));
  return { subscriptions, inMemory: pushSubscriptions.length };
}

async function clearOrphanSubscriptions(): Promise<number> {
  if (!supabase) return 0;
  const [usersRes, subsRes] = await Promise.all([
    supabase.from('users').select('id'),
    supabase.from('push_subscriptions').select('endpoint, user_id'),
  ]);
  const userIds = new Set((usersRes.data || []).map((u: any) => u.id));
  const orphans = (subsRes.data || []).filter((s: any) => !userIds.has(s.user_id));
  let removed = 0;
  for (const o of orphans) {
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', o.endpoint);
    if (!error) removed++;
  }
  return removed;
}

async function librarySearch(q?: string) {
  if (!supabase) return { tracks: [] };
  let query = supabase
    .from('tracks_library')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (q && q.trim()) {
    query = supabase
      .from('tracks_library')
      .select('*')
      .ilike('titulo', `%${q.trim()}%`)
      .order('created_at', { ascending: false })
      .limit(500);
  }
  const { data, error } = await query;
  if (error) return { tracks: [] };

  const refs = new Map<string, number>();
  const { data: rt } = await supabase.from('room_tracks').select('youtube_id');
  for (const r of rt || []) refs.set(r.youtube_id, (refs.get(r.youtube_id) || 0) + 1);

  const tracks = (data || []).map((t: any) => ({ ...t, references: refs.get(t.youtube_id) || 0 }));
  return { tracks };
}

async function proxyExtractor(pathname: string, opts: { method?: string; body?: string; timeoutMs?: number } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (EXTRACTOR_ADMIN_TOKEN) headers['X-Admin-Token'] = EXTRACTOR_ADMIN_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 10000);
  try {
    const res = await fetch(`${EXTRACTOR_BASE}${pathname}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* corpo não-JSON */
    }
    return { status: res.status, body: json };
  } catch (err: any) {
    return { status: 502, body: { error: { code: 'extractor_unreachable', message: err?.message || 'Extrator inacessível.' } } };
  } finally {
    clearTimeout(timer);
  }
}

async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  if (!adminEnabled()) {
    return reply.status(503).send({
      error: { code: 'admin_disabled', message: 'Central admin desabilitada (ADMIN_PASSWORD não definido).' },
    });
  }
  const ip = clientIp(request);
  const now = Date.now();
  const existing = loginAttempts.get(ip);
  if (existing && now - existing.firstTs >= LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
  }
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.count >= LOGIN_MAX) {
    return reply.status(429).send({
      error: { code: 'rate_limited', message: 'Muitas tentativas de login. Aguarde alguns minutos.' },
    });
  }

  const { username, password } = (request.body || {}) as any;
  const userOk = !ADMIN_USERNAME || (typeof username === 'string' && username === ADMIN_USERNAME);
  const passOk = typeof password === 'string' && password.length > 0 && safeEqual(password, ADMIN_PASSWORD);
  if (!userOk || !passOk) {
    const cur = loginAttempts.get(ip);
    if (cur) cur.count++;
    else loginAttempts.set(ip, { count: 1, firstTs: now });
    recordActivity('admin_login_failed', { actor: username || 'admin', detail: `IP ${ip}` });
    return reply.status(401).send({ error: { code: 'invalid_credentials', message: 'Credenciais inválidas.' } });
  }

  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, now + SESSION_TTL_MS);
  recordActivity('admin_login', { actor: 'admin', detail: `IP ${ip}` });
  log('info', `Login admin OK (IP ${ip})`);
  return { token, expiresAt: now + SESSION_TTL_MS };
}

export function registerAdminRoutes(fastify: FastifyInstance, io: Server) {
  // Limpeza periódica de sessões expiradas
  setInterval(() => {
    const now = Date.now();
    for (const [token, exp] of sessions) {
      if (exp < now) sessions.delete(token);
    }
  }, 15 * 60 * 1000).unref?.();

  fastify.post('/admin/login', loginHandler);

  fastify.get('/admin/overview', { preHandler: requireAdmin }, async () => {
    const media = await listMediaFiles();
    const [roomsTotal, tracksLib, roomTracks, usersTotal, subsTotal] = await Promise.all([
      countTable('rooms'),
      countTable('tracks_library'),
      countTable('room_tracks'),
      countTable('users'),
      countTable('push_subscriptions'),
    ]);
    let roomsPlaying = 0;
    let roomsPaused = 0;
    for (const r of rooms.values()) {
      if (r.playback.status === 'playing') roomsPlaying++;
      else roomsPaused++;
    }
    const vm = await getVmMetrics();
    return {
      roomsActive: rooms.size,
      roomsTotal,
      roomsPlaying,
      roomsPaused,
      tracksLibrary: tracksLib,
      roomTracks,
      usersTotal,
      pushSubscriptions: subsTotal,
      pushSubscriptionsInMemory: pushSubscriptions.length,
      media: { count: media.count, totalBytes: media.totalBytes, orphanBytes: media.orphanBytes },
      vm,
    };
  });

  fastify.get('/admin/tables', { preHandler: requireAdmin }, async () => {
    const tables: Array<{ name: string; count: number }> = [];
    for (const name of KNOWN_TABLES) tables.push({ name, count: await countTable(name) });
    return { tables };
  });

  fastify.get('/admin/tables/:name', { preHandler: requireAdmin }, async (request, reply) => {
    const { name } = request.params as any;
    if (!KNOWN_TABLES.includes(name)) {
      return reply.status(404).send({ error: { code: 'unknown_table', message: 'Tabela desconhecida.' } });
    }
    if (!supabase) return { name, count: 0, rows: [], columns: [] };
    const count = await countTable(name);
    const { data, error } = await supabase.from(name).select('*').limit(200);
    const rows = error || !data ? [] : data;
    const columns = Array.from(new Set(rows.flatMap((r: any) => Object.keys(r))));
    return { name, count, rows, columns };
  });

  fastify.get('/admin/library', { preHandler: requireAdmin }, async (request) => {
    const q = (request.query as any)?.q as string | undefined;
    return librarySearch(q);
  });

  fastify.put('/admin/library/:youtubeId', { preHandler: requireAdmin }, async (request, reply) => {
    const { youtubeId } = request.params as any;
    const { titulo, duracao_seg } = (request.body || {}) as any;
    if (!titulo && typeof duracao_seg !== 'number') {
      return reply.status(400).send({ error: { code: 'invalid_body', message: 'Informe titulo e/ou duracao_seg.' } });
    }
    await updateLibraryTrack(youtubeId, { titulo, duracao_seg });
    recordActivity('admin_action', { actor: 'admin', detail: `Faixa editada: ${youtubeId}` });
    return { status: 'ok' };
  });

  fastify.delete('/admin/library/:youtubeId', { preHandler: requireAdmin }, async (request, reply) => {
    const { youtubeId } = request.params as any;
    const { confirm } = (request.body || {}) as any;
    if (!confirm) {
      return reply.status(400).send({ error: { code: 'confirm_required', message: 'É preciso enviar confirm: true.' } });
    }
    const { existed, affectedRooms } = await deleteLibraryTrackByYoutubeId(youtubeId);
    for (const rid of affectedRooms) {
      const room = rooms.get(rid);
      if (room) {
        io.to(rid).emit('queue_updated', room.queue);
        io.to(rid).emit('playback_updated', room.playback);
      }
    }
    recordActivity('admin_action', { actor: 'admin', detail: `Faixa excluída da biblioteca: ${youtubeId}` });
    return { status: 'ok', existed };
  });

  // Remove da biblioteca faixas que não têm mais nenhum arquivo de mídia em
  // disco (ex.: vídeos apagados pela aba Mídias antes desta regra existir).
  fastify.post('/admin/library/prune', { preHandler: requireAdmin }, async () => {
    if (!supabase) return { removed: 0, removedTitles: [] };
    const { data, error } = await supabase.from('tracks_library').select('youtube_id, titulo');
    if (error) return { removed: 0, removedTitles: [] };

    let names: string[] | null = null;
    try {
      names = fs.readdirSync(DOWNLOADS_DIR);
    } catch {
      names = null;
    }
    // Sem a lista de arquivos não dá para confirmar se a faixa é órfã — não
    // apaga nada nesse caso (evita varrer a biblioteca por engano).
    if (!names) return { removed: 0, removedTitles: [] };

    const presentIds = new Set<string>();
    for (const f of names) {
      if (f.endsWith('.info.json')) continue;
      const m = f.match(/^([A-Za-z0-9_-]{11})/);
      if (m) presentIds.add(m[1]);
    }

    const removedTitles: string[] = [];
    let removedCount = 0;
    for (const row of (data || [])) {
      const youtubeId = row.youtube_id;
      if (!youtubeId || presentIds.has(youtubeId)) continue;
      const { existed, affectedRooms } = await deleteLibraryTrackByYoutubeId(youtubeId);
      if (existed) {
        removedCount += 1;
        if (row.titulo) removedTitles.push(row.titulo);
        for (const rid of affectedRooms) {
          const room = rooms.get(rid);
          if (room) {
            io.to(rid).emit('queue_updated', room.queue);
            io.to(rid).emit('playback_updated', room.playback);
          }
        }
      }
    }
    recordActivity('admin_action', { actor: 'admin', detail: `Biblioteca limpa: ${removedCount} faixa(s) sem arquivo removida(s)` });
    return { removed: removedCount, removedTitles };
  });

  fastify.get('/admin/users', { preHandler: requireAdmin }, async () => listUsers());

  fastify.delete('/admin/users/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as any;
    const { confirm } = (request.body || {}) as any;
    if (!confirm) {
      return reply.status(400).send({ error: { code: 'confirm_required', message: 'É preciso enviar confirm: true.' } });
    }
    await deleteUserCompletely(id);
    recordActivity('admin_action', { actor: 'admin', detail: `Usuário excluído: ${id}` });
    return { status: 'ok' };
  });

  fastify.get('/admin/push-subscriptions', { preHandler: requireAdmin }, async () => listPushSubscriptions());

  fastify.delete('/admin/push-subscriptions/orphans', { preHandler: requireAdmin }, async (request, reply) => {
    const { confirm } = (request.body || {}) as any;
    if (!confirm) {
      return reply.status(400).send({ error: { code: 'confirm_required', message: 'É preciso enviar confirm: true.' } });
    }
    const removed = await clearOrphanSubscriptions();
    recordActivity('admin_action', { actor: 'admin', detail: `Subscriptions órfãs limpas: ${removed}` });
    return { status: 'ok', removed };
  });

  fastify.post('/admin/push/test', { preHandler: requireAdmin }, async (request, reply) => {
    const { title, body } = (request.body || {}) as any;
    if (!title || !body) {
      return reply.status(400).send({ error: { code: 'invalid_body', message: 'Informe title e body.' } });
    }
    if (pushSubscriptions.length === 0) return { sent: 0 };
    const sent = await sendPushToSubs(pushSubscriptions, { title, body, url: '/rooms' });
    recordActivity('admin_action', { actor: 'admin', detail: `Push de teste enviado para ${sent} dispositivos` });
    return { sent };
  });

  fastify.get('/admin/rooms', { preHandler: requireAdmin }, async () => ({ rooms: await listRooms() }));

  fastify.get('/admin/rooms/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as any;
    const room = rooms.get(id);
    if (!room) {
      return reply.status(404).send({
        error: { code: 'room_inactive', message: 'Sala não está ativa em memória (sem clientes conectados).' },
      });
    }
    return {
      id: room.id,
      name: room.name,
      codigo_convite: room.codigo_convite,
      radialista_id: room.radialista_id,
      playback: room.playback,
      pausedForEmptyRoom: room.pausedForEmptyRoom,
      users: Array.from(room.users.values()),
      queue: room.queue,
      history: room.history.slice(-50).reverse(),
      chat: room.chat.slice(-50),
    };
  });

  fastify.put('/admin/rooms/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as any;
    const { name, codigo_convite } = (request.body || {}) as any;
    if (!name && !codigo_convite) {
      return reply.status(400).send({ error: { code: 'invalid_body', message: 'Informe name e/ou codigo_convite.' } });
    }
    await updateRoomInSupabase(id, { name, codigo_convite });
    const room = rooms.get(id);
    if (room) {
      io.to(id).emit('room_updated', { name: room.name, codigo_convite: room.codigo_convite });
    }
    recordActivity('admin_action', { actor: 'admin', detail: `Sala editada: ${id}` });
    return { status: 'ok' };
  });

  fastify.delete('/admin/rooms/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as any;
    const { confirm } = (request.body || {}) as any;
    if (!confirm) {
      return reply.status(400).send({ error: { code: 'confirm_required', message: 'É preciso enviar confirm: true.' } });
    }
    const existed = await deleteRoomCompletely(id);
    io.to(id).emit('room_closed', { reason: 'Sala excluída pelo administrador.' });
    io.in(id).socketsLeave(id);
    // Avisa todos os clientes (inclusive quem está na home) para remover a sala
    // da lista — o 'room_closed' acima só chega em quem está dentro da sala.
    io.emit('room_deleted', { id });
    recordActivity('admin_action', { actor: 'admin', detail: `Sala excluída: ${id}` });
    return { status: 'ok', existed };
  });

  fastify.post('/admin/rooms/:id/tracks', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as any;
    const { youtubeId, adicionadoPor } = (request.body || {}) as any;
    if (!youtubeId) {
      return reply.status(400).send({ error: { code: 'invalid_body', message: 'Informe youtubeId.' } });
    }
    const track = await addTrackToRoomQueue(id, youtubeId, adicionadoPor || 'admin');
    if (!track) {
      return reply.status(404).send({
        error: { code: 'not_found', message: 'Sala ou faixa da biblioteca não encontrada.' },
      });
    }
    const room = rooms.get(id);
    io.to(id).emit('queue_updated', room?.queue ?? []);
    io.to(id).emit('playback_updated', room?.playback);
    recordActivity('admin_action', { actor: 'admin', detail: `Música adicionada à sala ${id}: ${track.titulo}` });
    return { status: 'ok', track };
  });

  fastify.delete('/admin/rooms/:id/tracks/:trackId', { preHandler: requireAdmin }, async (request, reply) => {
    const { id, trackId } = request.params as any;
    const { confirm } = (request.body || {}) as any;
    if (!confirm) {
      return reply.status(400).send({ error: { code: 'confirm_required', message: 'É preciso enviar confirm: true.' } });
    }
    const ok = await removeTrackFromRoomQueue(id, trackId);
    const room = rooms.get(id);
    if (room) {
      io.to(id).emit('queue_updated', room.queue);
      io.to(id).emit('playback_updated', room.playback);
    }
    recordActivity('admin_action', { actor: 'admin', detail: `Música removida da sala ${id}: ${trackId}` });
    return { status: 'ok', ok };
  });

  fastify.get('/admin/media', { preHandler: requireAdmin }, async () => {
    const media = await listMediaFiles();
    return { ...media, storage: storageAnalysis(media.files) };
  });

  fastify.delete('/admin/media/:name', { preHandler: requireAdmin }, async (request, reply) => {
    const { name } = request.params as any;
    const { confirm } = (request.body || {}) as any;
    if (!confirm) {
      return reply.status(400).send({ error: { code: 'confirm_required', message: 'É preciso enviar confirm: true.' } });
    }
    const safe = path.basename(name);
    if (safe !== name || !safe || safe === '.' || safe === '..') {
      return reply.status(400).send({ error: { code: 'invalid_name', message: 'Nome de arquivo inválido.' } });
    }
    const full = path.join(DOWNLOADS_DIR, safe);
    if (!fs.existsSync(full)) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Arquivo não encontrado.' } });
    }
    fs.unlinkSync(full);
    if (!safe.endsWith('.info.json')) {
      const pair = path.join(DOWNLOADS_DIR, `${safe.replace(/\.[^.]+$/, '')}.info.json`);
      try {
        if (fs.existsSync(pair)) fs.unlinkSync(pair);
      } catch {
        /* segue mesmo se o .info.json não for apagado */
      }
    }

    // Se não restar nenhum arquivo de mídia do vídeo no disco, remove a faixa
    // da biblioteca e das filas — senão ela continua aparecendo no app para ser
    // adicionada, mas apontando para um arquivo que já não existe.
    let removedFromLibrary = false;
    const idMatch = safe.match(/^([A-Za-z0-9_-]{11})/);
    if (idMatch) {
      const youtubeId = idMatch[1];
      let remaining: string[] = [];
      try {
        remaining = fs.readdirSync(DOWNLOADS_DIR)
          .filter((f) => f !== safe && f.startsWith(youtubeId) && !f.endsWith('.info.json'));
      } catch {
        /* se não der para listar, considera que não sobrou nada */
      }
      if (remaining.length === 0) {
        const { existed, affectedRooms } = await deleteLibraryTrackByYoutubeId(youtubeId);
        removedFromLibrary = existed;
        for (const rid of affectedRooms) {
          const room = rooms.get(rid);
          if (room) {
            io.to(rid).emit('queue_updated', room.queue);
            io.to(rid).emit('playback_updated', room.playback);
          }
        }
      }
    }
    recordActivity('admin_action', { actor: 'admin', detail: `Mídia excluída: ${safe}${removedFromLibrary ? ' (também removida da biblioteca)' : ''}` });
    return { status: 'ok', removedFromLibrary };
  });

  fastify.get('/admin/logs', { preHandler: requireAdmin }, async (request) => {
    const lines = Number((request.query as any)?.lines) || 200;
    return { logs: getRecentLogs(lines) };
  });

  fastify.get('/admin/activity', { preHandler: requireAdmin }, async (request) => {
    const limit = Number((request.query as any)?.limit) || 100;
    return { activity: getRecentActivity(limit) };
  });

  fastify.get('/admin/vm', { preHandler: requireAdmin }, async () => ({ vm: await getVmMetrics() }));

  fastify.get('/admin/backup', { preHandler: requireAdmin }, async (request, reply) => {
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="rooms-backup-${Date.now()}.json"`);
    return reply.send(serializeRoomsForBackup());
  });

  fastify.post('/admin/refresh', { preHandler: requireAdmin }, async () => {
    await loadRooms();
    return { status: 'ok', rooms: rooms.size };
  });

  fastify.get('/admin/extractor/health', { preHandler: requireAdmin }, async () => {
    return proxyExtractor('/health');
  });

  fastify.get('/admin/extractor/logs', { preHandler: requireAdmin }, async () => {
    return proxyExtractor('/admin/logs');
  });

  fastify.post('/admin/extractor/meta', { preHandler: requireAdmin }, async (request, reply) => {
    const { url } = (request.body || {}) as any;
    if (!url) {
      return reply.status(400).send({ error: { code: 'invalid_body', message: 'Informe url.' } });
    }
    const result = await proxyExtractor('/extract/meta', {
      method: 'POST',
      body: JSON.stringify({ url }),
      timeoutMs: 25000,
    });
    if (result.status >= 400) reply.status(result.status);
    return result.body;
  });

  fastify.post('/admin/logout', { preHandler: requireAdmin }, async (request) => {
    const auth = request.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    sessions.delete(token);
    return { status: 'ok' };
  });
}
