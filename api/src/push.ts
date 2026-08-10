import webpush from 'web-push';
import { pushSubscriptions } from './store';

export const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  'BD29BGxbHjhrzUQrUHLiAaRJZDhr7fRP0F3PFtPGpCHLaGjEPKi-Ril1heXJwVOa_3GV-exRHHo4y8cROaaZGhY';
const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  '-oE_Pn-NNF6O38asWA_TOVEzPa4U4EsgM4iZ3aZz6gg';

webpush.setVapidDetails('mailto:contato@radiovideo.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export { webpush };

// Envia uma notificação para uma lista de inscrições. Remove automaticamente
// inscrições obsoletas (410/404). Retorna quantas foram enviadas com sucesso.
export async function sendPushToSubs(
  subs: Array<{ endpoint: string; sub: any; userId: string; muted_rooms: string[] }>,
  payload: any
): Promise<number> {
  const payloadStr = JSON.stringify(payload);
  let sent = 0;
  for (let i = subs.length - 1; i >= 0; i--) {
    try {
      await webpush.sendNotification(subs[i].sub, payloadStr);
      sent++;
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        pushSubscriptions.splice(i, 1);
      } else {
        console.error('Erro ao enviar push:', err);
      }
    }
  }
  return sent;
}
