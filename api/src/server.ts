import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { Server } from 'socket.io';
import { rooms, getOrCreateRoom, pickRadialista, User, Track } from './store';

const fastify = Fastify({ logger: true });

fastify.register(fastifyCors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', rooms_count: rooms.size };
});

const io = new Server(fastify.server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join_room', (data: { roomId: string, roomName: string, user: { id: string, name: string, avatar_url?: string } }) => {
    const { roomId, roomName, user } = data;
    socket.join(roomId);

    const room = getOrCreateRoom(roomId, roomName, user.id);

    const newUser: User = { ...user, socket_id: socket.id, entrou_em: Date.now() };
    room.users.set(socket.id, newUser);

    // Se a sala estava vazia, quem entrou primeiro é o radialista
    if (room.users.size === 1) {
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
        chat: room.chat,
        playback: room.playback,
        users: Array.from(room.users.values())
      }
    });

    // Notify others in the room
    socket.to(roomId).emit('user_joined', newUser);
    
    // Save current roomId in socket session for disconnect
    socket.data.roomId = roomId;
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
      }
      
      io.to(data.roomId).emit('queue_updated', room.queue);
      io.to(data.roomId).emit('playback_updated', room.playback);
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
          timestamp: data.timestamp
        };
        // Envia para todos, exceto quem disparou
        socket.to(data.roomId).emit('playback_updated', room.playback);
      }
    }
  });

  socket.on('force_radialista', (data: { roomId: string }) => {
    const room = rooms.get(data.roomId);
    if (!room || room.users.size === 0) return;

    const ids = Array.from(room.users.values()).map((u) => u.id);
    const currentIndex = ids.indexOf(room.radialista_id);
    const nextId = ids[(currentIndex + 1) % ids.length];
    room.radialista_id = nextId;

    io.to(data.roomId).emit('radialista_changed', room.radialista_id);
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
          if (next) {
            room.radialista_id = next;
            io.to(roomId).emit('radialista_changed', room.radialista_id);
          }
        }

        // Remove room if empty to save memory
        if (room.users.size === 0) {
          rooms.delete(roomId);
        }
      }
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

const start = async () => {
  try {
    await fastify.listen({ port: 3005, host: '0.0.0.0' });
    console.log(`Backend Realtime rodando na porta 3005`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
