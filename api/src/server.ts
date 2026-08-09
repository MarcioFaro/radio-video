import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { Server } from 'socket.io';
import webpush from 'web-push';
import { rooms, getOrCreateRoom, pickRadialista, User, Track, Room, pushSubscriptions, syncUserToSupabase, supabase, loadRooms, scheduleSave, saveTrackToSupabase, updateTrackStatusInSupabase, updateTrackOrderInSupabase, removeTrackFromSupabase, addFavoriteRoom, removeFavoriteRoom, getUserFavorites } from './store';
import { SEEDED_ROOM_ID, SEEDED_ROOM_NAME, SEEDED_ROOM_CODE, SEEDED_SONGS, SeedSong } from './seed';

const vapidKeys = {
  publicKey: 'BD29BGxbHjhrzUQrUHLiAaRJZDhr7fRP0F3PFtPGpCHLaGjEPKi-Ril1heXJwVOa_3GV-exRHHo4y8cROaaZGhY',
  privateKey: '-oE_Pn-NNF6O38asWA_TOVEzPa4U4EsgM4iZ3aZz6gg'
};

webpush.setVapidDetails(
  'mailto:contato@radiovideo.local',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const EXTRACTOR_URL = 'http://127.0.0.1:8000/extract';

async function resolveSeedTrack(song: SeedSong): Promise<Track> {
  const track: Track = {
    id: song.youtube_video_id,
    youtube_video_id: song.youtube_video_id,
    titulo: song.titulo,
    thumbnail_url: `https://i.ytimg.com/vi/${song.youtube_video_id}/maxresdefault.jpg`,
    duracao_seg: song.duracao_seg,
    adicionado_por: 'Sistema',
  };
  try {
    const res = await fetch(EXTRACTOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${song.youtube_video_id}` }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.thumbnail_url) track.thumbnail_url = data.thumbnail_url;
      if (data.duracao_seg) track.duracao_seg = data.duracao_seg;
      if (data.audio_url) track.audio_url = data.audio_url;
      if (data.video_url) track.video_url = data.video_url;
    }
  } catch {
    // Segue com metadado apenas se o extrator estiver fora.
  }
  return track;
}

async function seedRooms(): Promise<void> {
  if (rooms.has(SEEDED_ROOM_ID)) return;
  const queue = await Promise.all(SEEDED_SONGS.map(resolveSeedTrack));
  const seeded: Room = {
    id: SEEDED_ROOM_ID,
    name: SEEDED_ROOM_NAME,
    codigo_convite: SEEDED_ROOM_CODE,
    radialista_id: null,
    users: new Map(),
    queue,
    history: [],
    chat: [],
    playback: { status: 'paused', currentTrackId: queue[0]?.id ?? null, timestamp: 0, updated_at: Date.now() },
  };
  rooms.set(SEEDED_ROOM_ID, seeded);
  console.log(`[seed] Rádio "${SEEDED_ROOM_NAME}" criada com ${queue.length} músicas.`);
}

const fastify = Fastify({ logger: true });

fastify.register(fastifyCors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', rooms_count: rooms.size };
});

fastify.get('/rooms', async (request, reply) => {
  const activeRooms = Array.from(rooms.values()).map(r => {
    const radialista = r.radialista_id ? Array.from(r.users.values()).find(u => u.id === r.radialista_id) : null;
    return {
      id: r.id,
      name: r.name,
      codigo_convite: r.codigo_convite,
      usersCount: r.users.size,
      radialistaName: radialista ? radialista.name : null,
      tracksCount: r.queue.length
    };
  });
  return { rooms: activeRooms };
});

fastify.get('/library', async (request, reply) => {
  if (!supabase) return { tracks: [] };
  const { data, error } = await supabase.from('tracks_library').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Error fetching library:', error);
    return { tracks: [] };
  }
  return { tracks: data };
});

fastify.post('/push/subscribe', async (request, reply) => {
  const { userId, subscription } = request.body as any;
  if (!userId || !subscription) return reply.status(400).send({ error: 'Missing userId or subscription' });
  
  // Evitar duplicatas
  const existingIndex = pushSubscriptions.findIndex(s => s.endpoint === subscription.endpoint);
  if (existingIndex >= 0) {
    pushSubscriptions[existingIndex] = { ...pushSubscriptions[existingIndex], userId, endpoint: subscription.endpoint, sub: subscription };
  } else {
    pushSubscriptions.push({ userId, endpoint: subscription.endpoint, sub: subscription, muted_rooms: [] });
  }

  if (supabase) {
    supabase.from('push_subscriptions').upsert({
      endpoint: subscription.endpoint,
      user_id: userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    }).then(res => { if(res.error) console.error(res.error) });
  }

  return { status: 'ok' };
});

fastify.post('/push/settings', async (request, reply) => {
  const { endpoint, roomId, muted } = request.body as any;
  if (!endpoint || !roomId) return reply.status(400).send({ error: 'Missing endpoint or roomId' });
  
  const sub = pushSubscriptions.find(s => s.endpoint === endpoint);
  if (sub) {
    if (muted && !sub.muted_rooms.includes(roomId)) {
      sub.muted_rooms.push(roomId);
    } else if (!muted) {
      sub.muted_rooms = sub.muted_rooms.filter(id => id !== roomId);
    }
  }
  return { status: 'ok' };
});

fastify.post('/push/unsubscribe', async (request, reply) => {
  const { endpoint } = request.body as any;
  if (!endpoint) return reply.status(400).send({ error: 'Missing endpoint' });
  
  const index = pushSubscriptions.findIndex(s => s.endpoint === endpoint);
  if (index >= 0) pushSubscriptions.splice(index, 1);
  return { status: 'ok' };
});

// ── Favoritos ────────────────────────────────────────────────────────────────
fastify.get('/favorites/:userId', async (request, reply) => {
  const { userId } = request.params as any;
  const favorites = await getUserFavorites(userId);
  return { favorites };
});

fastify.post('/favorites', async (request, reply) => {
  const { userId, roomId, action } = request.body as any;
  if (!userId || !roomId || !action) return reply.status(400).send({ error: 'Missing params' });
  if (action === 'add') await addFavoriteRoom(userId, roomId);
  else if (action === 'remove') await removeFavoriteRoom(userId, roomId);
  return { status: 'ok' };
});


async function sendPushToRoom(roomId: string, senderId: string, payload: any) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const targetUserIds = Array.from(room.users.values())
    .filter(u => u.id !== senderId)
    .map(u => u.id);
    
  // Apenas inscritos que não mutaram a sala
  const subs = pushSubscriptions.filter(s => targetUserIds.includes(s.userId) && !s.muted_rooms.includes(roomId));
  
  const payloadStr = JSON.stringify(payload);
  
  for (let i = subs.length - 1; i >= 0; i--) {
    try {
      await webpush.sendNotification(subs[i].sub, payloadStr);
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Inscrição expirou ou foi revogada, remover
        pushSubscriptions.splice(i, 1);
      } else {
        console.error('Erro ao enviar push:', err);
      }
    }
  }
}

const io = new Server(fastify.server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('get_time', (callback) => {
    if (typeof callback === 'function') {
      callback(Date.now());
    }
  });

  socket.on('join_room', (data: { roomId: string, roomName: string, user: { id: string, name: string, avatar_url?: string } }) => {
    const { roomId, roomName, user } = data;
    socket.join(roomId);

    const room = getOrCreateRoom(roomId, roomName, user.id);

    // Se a sala estava vazia, a musica atual recomeca do zero para quem entrar
    const wasEmpty = room.users.size === 0;
    if (wasEmpty) {
      room.playback.timestamp = 0;
      room.playback.updated_at = Date.now();
    }

    const newUser: User = { ...user, socket_id: socket.id, entrou_em: Date.now() };
    room.users.set(socket.id, newUser);
    syncUserToSupabase(user);

    // Se a sala estava vazia ou sem radialista, quem entrar ganha o controle
    if (!room.radialista_id || room.users.size === 1) {
      room.radialista_id = user.id;
    }

    // Send full current state to the joining user
      socket.emit('sync_state', {
      room: {
        id: room.id,
        name: room.name,
        codigo_convite: room.codigo_convite,
        radialista_id: room.radialista_id,
        queue: room.queue,
        history: room.history,
        chat: room.chat,
        playback: room.playback,
        users: Array.from(room.users.values())
      }
    });

    // Notify others in the room
    socket.to(roomId).emit('user_joined', newUser);
    
    // Save current roomId in socket session for disconnect
    socket.data.roomId = roomId;

    scheduleSave();
  });

  socket.on('send_message', (data: { roomId: string, userName: string, text: string }) => {
    const { roomId, userName, text } = data;
    const room = rooms.get(roomId);
    if (room) {
      const msg = {
        id: Math.random().toString(36).substring(2, 9),
        user_name: userName,
        texto: text,
        timestamp: Date.now()
      };
      room.chat.push(msg);
      if (room.chat.length > 100) room.chat.shift();
      io.to(roomId).emit('chat_message', msg);
      scheduleSave();
      
      // Envia Push Notification
      const senderId = Array.from(room.users.values()).find(u => u.socket_id === socket.id)?.id;
      if (senderId) {
        sendPushToRoom(roomId, senderId, {
          title: `Nova mensagem na ${room.name}`,
          body: `${userName}: ${text}`,
          url: `/room/${roomId}`
        }).catch(console.error);
      }
    }
  });

  socket.on('add_track', (data: { roomId: string, track: Omit<Track, 'id'> }) => {
    const room = rooms.get(data.roomId);
    if (room) {
      const newTrack: Track = {
        ...data.track,
        id: Math.random().toString(36).substring(2, 9)
      };
      room.queue.push(newTrack);
      
      if (!room.playback.currentTrackId) {
        room.playback.currentTrackId = newTrack.id;
        room.playback.timestamp = 0;
        room.playback.updated_at = Date.now();
      }
      
      io.to(data.roomId).emit('queue_updated', room.queue);
      io.to(data.roomId).emit('playback_updated', room.playback);
      
      // Salva no Supabase
      saveTrackToSupabase(data.roomId, newTrack).catch(console.error);

      // Envia Push Notification
      const senderId = Array.from(room.users.values()).find(u => u.socket_id === socket.id)?.id;
      if (senderId) {
        sendPushToRoom(data.roomId, senderId, {
          title: `Nova música adicionada`,
          body: `${newTrack.titulo}`,
          url: `/room/${data.roomId}`
        }).catch(console.error);
      }
      
      scheduleSave();
    }
  });

  socket.on('track_ended', (data: { roomId: string, trackId: string }) => {
    const room = rooms.get(data.roomId);
    if (!room) return;
    
    if (room.playback.currentTrackId === data.trackId) {
      const trackIndex = room.queue.findIndex(t => t.id === data.trackId);
      if (trackIndex >= 0) {
        const track = room.queue[trackIndex];
        
        // Move para o histórico local
        room.history.push(track);
        if (room.history.length > 50) room.history.shift();
        
        // Marca como histórico no Supabase
        updateTrackStatusInSupabase(track.id, 'historico').catch(console.error);
        
        // Pega a próxima música
        const nextTrack = room.queue[trackIndex + 1];
        if (nextTrack) {
          room.playback = { status: 'playing', currentTrackId: nextTrack.id, timestamp: 0, updated_at: Date.now() };
        } else {
          room.playback = { status: 'paused', currentTrackId: null, timestamp: 0, updated_at: Date.now() };
        }
        
        io.to(data.roomId).emit('playback_updated', room.playback);
        scheduleSave();
      }
    }
  });

  socket.on('remove_track', (data: { roomId: string, trackId: string }) => {
    const room = rooms.get(data.roomId);
    if (!room) return;

    const user = room.users.get(socket.id);
    if (!user || user.id !== room.radialista_id) return;

    const index = room.queue.findIndex(t => t.id === data.trackId);
    if (index >= 0) {
      room.queue.splice(index, 1);
      io.to(data.roomId).emit('queue_updated', room.queue);
      
      // Remove do Supabase
      removeTrackFromSupabase(data.trackId).catch(console.error);
      scheduleSave();

      if (room.playback.currentTrackId === data.trackId) {
        const nextTrack = room.queue[index];
        if (nextTrack) {
          room.playback = { status: 'playing', currentTrackId: nextTrack.id, timestamp: 0, updated_at: Date.now() };
        } else {
          room.playback = { status: 'paused', currentTrackId: null, timestamp: 0, updated_at: Date.now() };
        }
        io.to(data.roomId).emit('playback_updated', room.playback);
        scheduleSave();
      }
    }
  });

  socket.on('update_playback', (data: { roomId: string, status: 'playing' | 'paused', currentTrackId: string, timestamp: number }) => {
    const room = rooms.get(data.roomId);
    if (room) {
      const user = room.users.get(socket.id);
      // Apenas o radialista pode controlar o player global
      if (user && user.id === room.radialista_id) {
        room.playback = {
          status: data.status,
          currentTrackId: data.currentTrackId,
          timestamp: data.timestamp,
          updated_at: Date.now()
        };
        // Envia para todos (incluindo o radialista para sincronizar o updated_at)
        io.to(data.roomId).emit('playback_updated', room.playback);
        scheduleSave();
      }
    }
  });

  socket.on('force_radialista', (data: { roomId: string }) => {
    const room = rooms.get(data.roomId);
    if (!room || room.users.size === 0) return;

    const ids = Array.from(room.users.values())
      .sort((a, b) => a.entrou_em - b.entrou_em)
      .map((u) => u.id);
    if (!room.radialista_id) return;
    const currentIndex = ids.indexOf(room.radialista_id);
    const nextId = ids[(currentIndex + 1) % ids.length];
    room.radialista_id = nextId;

    io.to(data.roomId).emit('radialista_changed', room.radialista_id);
    scheduleSave();
  });

  socket.on('seek_playback', (data: { roomId: string, timestamp: number }) => {
    const room = rooms.get(data.roomId);
    if (!room) return;

    const user = room.users.get(socket.id);
    if (!user || user.id !== room.radialista_id) return;

    // Atualiza só o timestamp, mantém status/faixa
    room.playback = {
      status: room.playback.status,
      currentTrackId: room.playback.currentTrackId,
      timestamp: data.timestamp,
      updated_at: Date.now()
    };
    // Envia para todos (incluindo o radialista para sincronizar o updated_at)
    io.to(data.roomId).emit('playback_updated', room.playback);
    scheduleSave();
  });

  socket.on('reorder_queue', (data: { roomId: string, orderedIds: string[] }) => {
    const room = rooms.get(data.roomId);
    if (!room) return;

    const user = room.users.get(socket.id);
    if (!user || user.id !== room.radialista_id) return;

    if (!Array.isArray(data.orderedIds)) return;
    const byId = new Map(room.queue.map((t) => [t.id, t]));
    if (data.orderedIds.length !== room.queue.length) return;
    const reordered = data.orderedIds.map((id) => byId.get(id));
    if (reordered.some((t) => !t)) return;

    room.queue = reordered as Track[];
    io.to(data.roomId).emit('queue_updated', room.queue);
    
    // Atualiza a ordem no Supabase
    updateTrackOrderInSupabase(data.roomId, room.queue).catch(console.error);
    scheduleSave();
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const leaving = room.users.get(socket.id);
        room.users.delete(socket.id);
        io.to(roomId).emit('user_left', { socket_id: socket.id, users: Array.from(room.users.values()) });

        // Se o radialista saiu, transfere o papel para o membro mais antigo restante
        if (leaving && leaving.id === room.radialista_id) {
          const next = pickRadialista(room);
          room.radialista_id = next; // Retorna nulo se estiver vazia
          io.to(roomId).emit('radialista_changed', room.radialista_id);
        }
        
        scheduleSave();
      }
    }
    console.log(`User disconnected: ${socket.id}`);
  });

  socket.on('leave_room', (data: { roomId: string }) => {
    const roomId = data.roomId;
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const leaving = room.users.get(socket.id);
        room.users.delete(socket.id);
        io.to(roomId).emit('user_left', { socket_id: socket.id, users: Array.from(room.users.values()) });

        // Se o radialista saiu, transfere o papel
        if (leaving && leaving.id === room.radialista_id) {
          const next = pickRadialista(room);
          room.radialista_id = next; // Retorna nulo se estiver vazia
          io.to(roomId).emit('radialista_changed', room.radialista_id);
        }

        scheduleSave();
      }
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.playback.status === 'playing' && room.playback.currentTrackId) {
      const trackIndex = room.queue.findIndex(t => t.id === room.playback.currentTrackId);
      if (trackIndex >= 0) {
        const track = room.queue[trackIndex];
        const expectedTimeSec = room.playback.timestamp + (now - room.playback.updated_at) / 1000;
        
        const validDuration = track.duracao_seg || Infinity;
        // Failsafe do servidor (dá 10 segundos de margem para o front-end avançar primeiro via onEnded)
        if (expectedTimeSec >= validDuration + 10) {
          // O cliente não enviou 'track_ended', então o servidor força o avanço
          room.history.push(track);
          if (room.history.length > 50) room.history.shift();
          io.to(room.id).emit('history_updated', room.history);

          const nextTrack = room.queue[trackIndex + 1];
          if (nextTrack) {
            room.playback = {
              status: 'playing',
              currentTrackId: nextTrack.id,
              timestamp: 0,
              updated_at: now
            };
          } else {
            room.playback = {
              status: 'paused',
              currentTrackId: null,
              timestamp: 0,
              updated_at: now
            };
          }
          io.to(room.id).emit('playback_updated', room.playback);
          scheduleSave();
        }
      }
    }
  }
}, 1000);

const start = async () => {
  try {
    loadRooms();
    await seedRooms();
    await fastify.listen({ port: 3005, host: '0.0.0.0' });
    console.log(`Backend Realtime rodando na porta 3005`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
