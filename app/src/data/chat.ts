import type { ChatMessage } from './types';
import { subscribe, notify } from './pubsub';

const chatByRoom = new Map<string, ChatMessage[]>();

const subKey = (roomId: string) => `chat:${roomId}`;

export function applyMessages(roomId: string, messages: ChatMessage[]): void {
  chatByRoom.set(roomId, [...messages]);
  notify(subKey(roomId));
}

export function appendMessage(roomId: string, msg: ChatMessage): void {
  const messages = getMessages(roomId);
  messages.push(msg);
  if (messages.length > 100) messages.shift();
  chatByRoom.set(roomId, [...messages]);
  notify(subKey(roomId));
}

export function subscribeChat(roomId: string, cb: () => void): () => void {
  return subscribe(subKey(roomId), cb);
}

export function getMessages(roomId: string): ChatMessage[] {
  if (!chatByRoom.has(roomId)) {
    chatByRoom.set(roomId, []);
  }
  return chatByRoom.get(roomId)!;
}

export function sendMessage(roomId: string, userName: string, texto: string): ChatMessage {
  const msg: ChatMessage = {
    id: Math.random().toString(36).slice(2, 9),
    user_name: userName,
    texto,
    timestamp: Date.now(),
  };
  const messages = getMessages(roomId);
  messages.push(msg);
  if (messages.length > 100) messages.shift();
  chatByRoom.set(roomId, [...messages]);
  notify(subKey(roomId));
  return msg;
}

export function clearChat(roomId: string): void {
  chatByRoom.delete(roomId);
}
