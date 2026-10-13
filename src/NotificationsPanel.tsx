import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type SiteNotification } from './api';
import { formatDate } from './date';
import { sanitize } from './html';
import { links } from './links';
import s from './NotificationsPanel.module.css';

/** Notification.STATUSES — подпись и цвет карточки (цвета — из старого окна сайта). */
const STATUS: Record<string, { label: string; tone: string }> = {
  I: { label: 'Сообщение', tone: 'info' },
  E: { label: 'Ошибка', tone: 'error' },
  S: { label: 'Успешно', tone: 'success' },
  SP: { label: 'Обращение в поддержку', tone: 'support' },
  M: { label: 'На модерации', tone: 'moderation' },
  MN: { label: 'Транзакция', tone: 'money' },
  PS: { label: 'Публикация текста', tone: 'post' },
  C: { label: 'Новый комментарий', tone: 'comment' },
  CU: { label: 'Упоминание в комментарии', tone: 'mention' },
};

const PAGE = 30;

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; items: SiteNotification[]; more: boolean };

interface Props {
  username: string;
  /** Подписка на новые уведомления из сокета, пока окно открыто. */
  subscribe: (fn: (n: SiteNotification) => void) => () => void;
  /** Сервер прочитал — актуальное число непрочитанных. */
  onUnread: (unread: number) => void;
  onClose: () => void;
}

/**
 * Окно непрочитанных уведомлений. При открытии загружает их и сразу отмечает
 * прочитанными — до id самого нового показанного (то, что пришло позже, не теряется).
 * Порталом в body: на мобильном сайдбар сдвинут transform-ом, и fixed внутри
 * него считался бы от сайдбара.
 */
export default function NotificationsPanel({ username, subscribe, onUnread, onClose }: Props) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const onUnreadRef = useRef(onUnread);
  onUnreadRef.current = onUnread;

  const markRead = useCallback((upTo: number) => {
    api.readNotifications(upTo).then(
      (r) => onUnreadRef.current(r.unread),
      () => {}, // не вышло — счётчик останется, при следующем открытии попробуем снова
    );
  }, []);

  useEffect(() => {
    let alive = true;
    setLoad({ state: 'loading' });
    api.notifications({ limit: PAGE }).then(
      (page) => {
        if (!alive) return;
        setLoad({ state: 'ready', items: page.objects, more: page.more });
        const newest = Math.max(0, ...page.objects.map((n) => n.id));
        if (newest) markRead(newest);
        else onUnreadRef.current(page.unread);
      },
      () => alive && setLoad({ state: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [attempt, markRead]);

  // новое уведомление, пока окно открыто, — показываем сверху и сразу читаем
  useEffect(
    () =>
      subscribe((n) => {
        setLoad((l) => (l.state === 'ready' && !l.items.some((x) => x.id === n.id) ? { ...l, items: [n, ...l.items] } : l));
        markRead(n.id);
      }),
    [subscribe, markRead],
  );

  // Esc закрывает; фокус — в окно, по закрытию вернёт UserBar
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className={s.backdrop} onClick={onClose} />
      <div ref={panelRef} className={s.panel} role="dialog" aria-modal="true" aria-labelledby="ub-notif-title" tabIndex={-1}>
        <div className={s.head}>
          <h2 id="ub-notif-title" className={s.title}>
            Уведомления
          </h2>
          <button className={s.close} onClick={onClose} aria-label="Закрыть">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path d="M5 5l30 30M35 5L5 35" stroke="currentColor" strokeWidth="3" />
            </svg>
          </button>
        </div>

        <a className={s.all} href={links.notifications(username)}>
          Все уведомления
        </a>

        <div className={s.list}>
          {load.state === 'loading' && <Loader />}
          {load.state === 'error' && (
            <div className={s.note}>
              Не удалось загрузить уведомления.{' '}
              <button className={s.retry} onClick={() => setAttempt((a) => a + 1)}>
                Повторить
              </button>
            </div>
          )}
          {load.state === 'ready' && load.items.length === 0 && <div className={s.note}>Новых уведомлений нет</div>}
          {load.state === 'ready' &&
            load.items.map((n) => {
              const status = STATUS[n.status] ?? STATUS.I;
              return (
                <article key={n.id} className={s.card} data-tone={status.tone}>
                  <div className={s.meta}>
                    <span className={s.label}>{status.label}</span>
                    <time className={s.date} dateTime={n.date}>
                      {formatDate(n.date)}
                    </time>
                  </div>
                  <div className={s.content} dangerouslySetInnerHTML={{ __html: sanitize(n.content) }} />
                </article>
              );
            })}
          {load.state === 'ready' && load.more && (
            <a className={s.more} href={links.notifications(username)}>
              Остальные — на странице всех уведомлений
            </a>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

function Loader() {
  return (
    <div className={s.loader} aria-label="Загрузка">
      {[0, 1, 2].map((i) => (
        <span key={i} className={s.ghostCard} />
      ))}
    </div>
  );
}
