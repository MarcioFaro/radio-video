import { rooms, getOrCreateRoom, scheduleSave, loadRooms } from './store';
import fs from 'fs';

loadRooms();
const room = getOrCreateRoom('test-room', 'Test', 'user1');
room.queue.push({
  id: '1',
  youtube_video_id: '123',
  titulo: 'Test',
  thumbnail_url: '',
  duracao_seg: 10,
  adicionado_por: 'me'
});
console.log('Queue before save:', room.queue.length);
scheduleSave();

setTimeout(() => {
  console.log('Saved to disk.');
  const data = JSON.parse(fs.readFileSync('../data/rooms.json', 'utf-8'));
  console.log('Loaded from disk:', data['test-room'].queue.length);
}, 6000);
