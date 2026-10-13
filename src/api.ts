/** Текущий пользователь: /api/v1/users/session/self/ */
export interface Me {
  id: number;
  username: string;
  name: string;
  avatar: string | null;
  is_staff?: boolean;
  groups?: string[];
}

/** /api/v1/users/balance/ */
export interface Balance {
  lits: number;
  books: number;
}

/** /api/v1/chat/unread/ и /api/v1/users/session/notifications/unread/ */
export interface Unread {
  unread: number;
}

/** Уведомление из события new_notification. */
export interface SiteNotification {
  id: number;
  /** I, E, S, SP, M, MN, PS, C, CU — см. Notification.STATUSES */
  status: string;
  content: string;
  is_read: boolean;
  date: string;
  /** AL — Альтерлит, ALT — AltCG, ALL — оба сайта */
  site: string;
}

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

/** Страница уведомлений: GET /api/v1/users/session/notifications/ */
export interface NotificationPage {
  objects: SiteNotification[];
  more: boolean;
  offset: number;
  unread: number;
}

let csrfFallback = '';
/** Токен CSRF, если куки csrftoken нет: <div id="alterlit-userbar" data-csrf="{{ csrf_token }}"> */
export function setCsrfFallback(token: string) {
  csrfFallback = token;
}

function csrfToken() {
  const m = document.cookie.match(/(?:^|; )csrftoken=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : csrfFallback;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    const token = csrfToken();
    if (token) headers.set('X-CSRFToken', token);
  }
  const r = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  if (!r.ok) throw new HttpError(r.status);
  return (await r.json()) as T;
}

const get = <T>(url: string) => request<T>(url);
const NOTIFICATIONS = '/api/v1/users/session/notifications/';

export const api = {
  me: () => get<Me>('/api/v1/users/session/self/'),
  balance: () => get<Balance>('/api/v1/users/balance/'),
  unreadMessages: () => get<Unread>('/api/v1/chat/unread/'),
  unreadNotifications: () => get<Unread>(`${NOTIFICATIONS}unread/`),
  /** Непрочитанные уведомления сайта, новые сверху; all — все. */
  notifications: ({ all = false, offset = 0, limit = 30 } = {}) =>
    get<NotificationPage>(`${NOTIFICATIONS}?${new URLSearchParams({ ...(all ? { all: '1' } : {}), offset: String(offset), limit: String(limit) })}`),
  /** Прочитать непрочитанные с id <= upTo (показанные в окне и всё, что старше). */
  readNotifications: (upTo: number) =>
    request<{ marked: number; unread: number }>(`${NOTIFICATIONS}read/`, {
      method: 'POST',
      body: JSON.stringify({ up_to: upTo }),
    }),
};
