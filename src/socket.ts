import type { Balance, SiteNotification } from './api';

/** События личного потока ws/chat/stream/, которые интересны блоку пользователя. */
export type StreamEvent =
  | { type: 'new_notification'; notification: SiteNotification }
  | { type: 'notifications_count'; unread: number }
  | { type: 'balance'; balance: Balance }
  | { type: 'transaction' | 'pay_order'; [key: string]: unknown }
  | { type: 'new_message'; room_id: number; message_data?: { sender_id: number } }
  | { type: 'remove_message' | 'room_read' | 'room_deleted' | 'room_restored'; room_id: number }
  | { type: string; [key: string]: unknown };

interface Options {
  onEvent: (event: StreamEvent) => void;
  /** Соединение (пере)открыто: reconnected — после обрыва, события могли потеряться. */
  onOpen: (reconnected: boolean) => void;
}

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

function wsUrl(path: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = import.meta.env.VITE_WS_HOST || location.host;
  return `${proto}://${host}${path}`;
}

/** Личный поток пользователя (тот же, что слушает чат): переподключение с backoff, ping. */
export function openStream(opts: Options) {
  let ws: WebSocket | null = null;
  let attempts = 0;
  let everOpened = false;
  let stopped = false;
  let pingTimer: number | undefined;
  let retryTimer: number | undefined;

  const connect = () => {
    if (stopped) return;
    const socket = new WebSocket(wsUrl('/ws/chat/stream/'));
    ws = socket;

    socket.onopen = () => {
      opts.onOpen(everOpened);
      everOpened = true;
      attempts = 0;
      pingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ message: { type: 'ping' } }));
      }, PING_MS);
    };

    socket.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data as string) as { message?: StreamEvent };
        if (payload.message && payload.message.type !== 'ping') opts.onEvent(payload.message);
      } catch {
        /* не-JSON игнорируем */
      }
    };

    socket.onclose = (e) => {
      window.clearInterval(pingTimer);
      // 4001 — сервер не узнал пользователя: переподключение не поможет
      if (stopped || e.code === 4001 || e.code === 4003) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts) + Math.random() * 1000;
      attempts += 1;
      retryTimer = window.setTimeout(connect, delay);
    };
  };

  connect();

  return () => {
    stopped = true;
    window.clearInterval(pingTimer);
    window.clearTimeout(retryTimer);
    ws?.close();
  };
}
