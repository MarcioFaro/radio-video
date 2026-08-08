import type { ChatMessage } from './types';

const chatByRoom = new Map<string, ChatMessage[]>();

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
  return msg;
}

export function clearChat(roomId: string): void {
  chatByRoom.delete(roomId);
}
