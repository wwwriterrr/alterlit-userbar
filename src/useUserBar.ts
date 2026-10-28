import { useCallback, useEffect, useRef, useState } from 'react';
import { api, HttpError, type Balance, type Me, type SiteNotification } from './api';
import { openStream, type StreamEvent } from './socket';

type NotificationListener = (n: SiteNotification) => void;

export interface UserBarState {
  status: 'loading' | 'ready' | 'anon' | 'error';
  me: Me | null;
  balance: Balance | null;
  messages: number;
  notifications: number;
  /** Первая загрузка счётчиков завершена — до неё нули ничего не значат. */
  counted: boolean;
}

/** Вкладка была скрыта дольше — по возвращении сверяем счётчики и баланс. */
const STALE_AFTER_MS = 60_000;
/** Пачка событий (несколько сообщений подряд) → один запрос счётчика. */
const REFETCH_DELAY_MS = 400;

const MESSAGE_EVENTS = new Set(['new_message', 'remove_message', 'room_read', 'room_deleted', 'room_restored']);

/**
 * Данные блока: пользователь, баланс, непрочитанные сообщения и уведомления.
 * Счётчики живут от личного потока ws/chat/stream/: новое уведомление прибавляет 1,
 * прочтение или удаление приходит готовым числом, а на события чата счётчик
 * сообщений перезапрашивается. Баланс тоже приходит из потока готовыми числами.
 */
export function useUserBar() {
  const [state, setState] = useState<UserBarState>({
    status: 'loading',
    me: null,
    balance: null,
    messages: 0,
    notifications: 0,
    counted: false,
  });
  const meId = useRef<number | null>(null);
  const listeners = useRef(new Set<NotificationListener>());

  useEffect(() => {
    let alive = true;
    const patch = (next: Partial<UserBarState>) => alive && setState((s) => ({ ...s, ...next }));

    // ошибки счётчиков и баланса не ломают блок — остаётся последнее известное значение
    const loadMessages = () => api.unreadMessages().then((r) => patch({ messages: r.unread }), () => {});
    const loadNotifications = () => api.unreadNotifications().then((r) => patch({ notifications: r.unread }), () => {});
    const loadBalance = () => api.balance().then((balance) => patch({ balance }), () => {});
    const loadAll = () => Promise.all([loadMessages(), loadNotifications(), loadBalance()]);

    let refetchTimer: number | undefined;
    const refetchMessages = () => {
      window.clearTimeout(refetchTimer);
      refetchTimer = window.setTimeout(loadMessages, REFETCH_DELAY_MS);
    };

    const onEvent = (event: StreamEvent) => {
      // сервер шлёт только уведомления сайта, на котором открыта вкладка
      if (event.type === 'new_notification') {
        const n = event.notification as SiteNotification | undefined;
        if (n && !n.is_read && alive) setState((s) => ({ ...s, notifications: s.notifications + 1 }));
        if (n) listeners.current.forEach((fn) => fn(n));
        // странице уведомлений (/notifications/) — без своего сокета: она добавит его в ленту
        if (n) window.dispatchEvent(new CustomEvent('alterlit:notification', { detail: n }));
        return;
      }
      if (event.type === 'notifications_count') {
        if (typeof event.unread === 'number') patch({ notifications: event.unread });
        return;
      }
      // баланс приходит готовыми числами — литы и буки вместе
      if (event.type === 'balance') {
        const balance = event.balance as Balance | undefined;
        if (balance && typeof balance.lits === 'number' && typeof balance.books === 'number') patch({ balance });
        return;
      }
      // лента «последние комментарии» изменилась — острову ленты в сайдбаре (без своего сокета)
      if (event.type === 'side_comments') {
        const { type, ...detail } = event;
        void type;
        window.dispatchEvent(new CustomEvent('alterlit:side-comments', { detail }));
        return;
      }
      // подробности — старому коду сайта (страницы финансов и оплаты), блоку хватает баланса
      if (event.type === 'transaction' || event.type === 'pay_order') {
        const { type, ...detail } = event;
        window.dispatchEvent(new CustomEvent(type === 'transaction' ? 'alterlit:transaction' : 'alterlit:pay-order', { detail }));
        return;
      }
      if (!MESSAGE_EVENTS.has(event.type)) return;
      // своё же сообщение (из другой вкладки) счётчик не меняет
      if (event.type === 'new_message') {
        const data = event.message_data as { sender_id?: number } | undefined;
        if (data?.sender_id === meId.current) return;
      }
      refetchMessages();
    };

    let closeStream: (() => void) | undefined;
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt > STALE_AFTER_MS) loadAll();
        hiddenAt = null;
      }
    };

    api.me().then(
      (me) => {
        if (!alive) return;
        meId.current = me.id;
        patch({ me, status: 'ready' });
        loadAll().then(() => patch({ counted: true }));
        closeStream = openStream({
          onEvent,
          // после обрыва события могли потеряться — сверяемся
          onOpen: (reconnected) => reconnected && loadAll(),
        });
        document.addEventListener('visibilitychange', onVisibility);
      },
      (e: unknown) => {
        const anon = e instanceof HttpError && (e.status === 401 || e.status === 403);
        patch({ status: anon ? 'anon' : 'error' });
      },
    );

    return () => {
      alive = false;
      window.clearTimeout(refetchTimer);
      closeStream?.();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // для старого кода сайта (точка «непрочитано» на мобильной кнопке меню и т. п.)
  const { counted, messages, notifications } = state;
  useEffect(() => {
    if (!counted) return;
    window.dispatchEvent(new CustomEvent('alterlit:unread', { detail: { messages, notifications } }));
  }, [counted, messages, notifications]);

  // баланс — тоже наружу: на старых страницах сайта он выведен своими элементами
  const { balance } = state;
  useEffect(() => {
    if (balance) window.dispatchEvent(new CustomEvent('alterlit:balance', { detail: balance }));
  }, [balance]);

  /** Новые уведомления из сокета — для открытого окна. */
  const subscribe = useCallback((fn: NotificationListener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);
  const setNotifications = useCallback((notifications: number) => setState((s) => ({ ...s, notifications })), []);

  return { ...state, subscribe, setNotifications };
}
