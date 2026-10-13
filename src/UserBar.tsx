import { useCallback, useEffect, useRef, useState } from 'react';
import { IconBell, IconBook, IconLit, IconMessages } from './Icons';
import { links } from './links';
import NotificationsPanel from './NotificationsPanel';
import { useUserBar } from './useUserBar';
import s from './UserBar.module.css';

/** Значок у имени — как в чате: владелец сайта — красный, администрация (is_staff) — синий. */
const OWNER_ID = 79691;
const BADGE_LABEL = { staff: 'Администрация сайта', owner: 'Владелец сайта' } as const;

/** Больше — вместо цифры белая точка в красном круге; точное число — в подсказке. */
const MAX_SHOWN = 9;

type Forms = [one: string, few: string, many: string];
const UNREAD_MESSAGES: Forms = ['непрочитанное сообщение', 'непрочитанных сообщения', 'непрочитанных сообщений'];
const NEW_NOTIFICATIONS: Forms = ['новое уведомление', 'новых уведомления', 'новых уведомлений'];

function plural(n: number, [one, few, many]: Forms) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export default function UserBar() {
  const { status, me, balance, messages, notifications, subscribe, setNotifications } = useUserBar();
  const [panelOpen, setPanelOpen] = useState(false);
  const bellRef = useRef<HTMLAnchorElement>(null);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    bellRef.current?.focus();
  }, []);

  if (status === 'anon') return null;
  if (status !== 'ready' || !me) return <Skeleton failed={status === 'error'} />;

  const badge = me.id === OWNER_ID ? 'owner' : me.is_staff ? 'staff' : null;

  return (
    <div className={s.root}>
      <div className={s.top}>
        <a className={s.avatarLink} href={links.profile(me.username)}>
          <Avatar id={me.id} name={me.name} src={me.avatar} />
        </a>
        <div className={s.right}>
          <a className={s.name} href={links.profile(me.username)}>
            <span className={s.nameText}>{me.name}</span>
            {badge && <AdminBadge kind={badge} />}
          </a>
          <div className={s.controls}>
            <CounterLink href={links.messages()} count={messages} label="Сообщения" forms={UNREAD_MESSAGES}>
              <IconMessages />
            </CounterLink>
            <CounterLink
              ref={bellRef}
              href={links.notifications(me.username)}
              count={notifications}
              label="Уведомления"
              forms={NEW_NOTIFICATIONS}
              expanded={panelOpen}
              // непрочитанные есть — окно с ними, нет — обычный переход на страницу всех уведомлений
              onClick={(e) => {
                if (notifications === 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                setPanelOpen((open) => !open);
              }}
            >
              <IconBell />
            </CounterLink>
            <a className={s.logout} href={links.logout()}>
              Выход
            </a>
          </div>
        </div>
      </div>

      {panelOpen && (
        <NotificationsPanel username={me.username} subscribe={subscribe} onUnread={setNotifications} onClose={closePanel} />
      )}

      <div className={s.balanceRow}>
        <a className={s.balance} href={links.finance()}>
          <span className={s.balanceLabel}>На счету:</span>
          <span className={s.amounts}>
            {balance ? (
              <>
                <span className={s.lits} title="Литы">
                  {money.format(balance.lits)}
                  <IconLit className={s.litIcon} />
                </span>
                <span className={s.books} title="Буки">
                  {money.format(balance.books)}
                  <IconBook className={s.bookIcon} />
                </span>
              </>
            ) : (
              <>
                <GhostAmount />
                <GhostAmount />
              </>
            )}
          </span>
        </a>
        <a className={s.pay} href={links.pay()}>
          Пополнить
        </a>
      </div>
    </div>
  );
}

/** Иконка-ссылка со счётчиком; при росте счётчика он «пульсирует», как на сайте. */
function CounterLink({
  ref,
  href,
  count,
  label,
  forms,
  expanded,
  onClick,
  children,
}: {
  ref?: React.Ref<HTMLAnchorElement>;
  href: string;
  count: number;
  label: string;
  forms: Forms;
  expanded?: boolean;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  children: React.ReactNode;
}) {
  const prev = useRef(count);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (count > prev.current) setPulse((p) => p + 1);
    prev.current = count;
  }, [count]);

  const title = count > 0 ? `${label}: ${count} ${plural(count, forms)}` : label;
  return (
    <a
      ref={ref}
      className={s.iconLink}
      href={href}
      aria-label={title}
      title={title}
      onClick={onClick}
      aria-expanded={expanded}
      aria-haspopup={onClick && count > 0 ? 'dialog' : undefined}
    >
      {children}
      {count > 0 && (
        // key меняется — анимация проигрывается заново
        <span
          key={pulse}
          className={s.counter}
          data-pulse={pulse > 0 || undefined}
          data-many={count > MAX_SHOWN || undefined}
          aria-hidden="true"
        >
          {count > MAX_SHOWN ? <span className={s.dot} /> : count}
        </span>
      )}
    </a>
  );
}

const AVATAR_COLORS = ['#254F23', '#C9861E', '#407BC8', '#B85454', '#5B48D1', '#2F8C9C', '#6B7F2A', '#8A5A3C'];

function Avatar({ id, name, src }: { id: number; name: string; src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img className={s.avatar} src={src} alt="" onError={() => setBroken(true)} />;
  }
  const parts = name.trim().split(/[\s_.-]+/).filter(Boolean);
  const initials = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2);
  return (
    <span className={s.avatar} style={{ background: AVATAR_COLORS[id % AVATAR_COLORS.length] }} aria-hidden="true">
      {initials.toUpperCase()}
    </span>
  );
}

function AdminBadge({ kind }: { kind: keyof typeof BADGE_LABEL }) {
  return (
    <svg className={s.badge} data-kind={kind} viewBox="0 0 50 50" role="img" aria-label={BADGE_LABEL[kind]}>
      <title>{BADGE_LABEL[kind]}</title>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M25 48C37.7025 48 48 37.7025 48 25C48 17.5654 44.4725 10.9547 39 6.75025C35.8069 25.6826 32.9139 35.1307 25 48ZM11 6.75025C14.1931 25.6826 17.0861 35.1307 25 48C12.2975 48 2 37.7025 2 25C2 17.5654 5.52745 10.9547 11 6.75025ZM13.1778 5.26687C22.46 8.25353 27.6384 8.35772 36.8222 5.26687C33.3674 3.19265 29.323 2 25 2C20.677 2 16.6326 3.19265 13.1778 5.26687Z"
      />
      <path d="M19.2778 11C19.0769 10.2616 19.183 10.0051 20 10H30C30.8111 10.0027 30.9445 10.2249 30.7445 10.9199L28.7778 18C28.5214 18.8123 28.2295 19.0106 27.5 19H22.5C21.6701 18.9923 21.4421 18.7134 21.2222 18L19.2778 11Z" />
      <path d="M19 33C20.9255 37.9373 22.2483 40.673 25 45.5C27.6861 40.8225 29.0148 38.0944 31 33L28.6793 21.3963C28.5251 20.7218 28.2919 20.4994 27.5 20.5H22.5C21.7009 20.4917 21.4615 20.7077 21.3207 21.3963L19 33Z" />
    </svg>
  );
}

/** Полупрозрачный скелетон по форме блока, пока грузится пользователь, — сайдбар не прыгает. */
function Skeleton({ failed }: { failed: boolean }) {
  if (failed) {
    return (
      <div className={s.root}>
        <div className={s.failed}>Не удалось загрузить профиль</div>
      </div>
    );
  }
  return (
    <div className={`${s.root} ${s.skeleton}`} aria-busy="true" aria-label="Загрузка профиля">
      <div className={s.top}>
        <span className={`${s.avatar} ${s.ghost}`} />
        <div className={s.right}>
          <span className={`${s.ghost} ${s.gName}`} />
          <div className={s.controls}>
            <span className={`${s.iconLink} ${s.ghost} ${s.gRound}`} />
            <span className={`${s.iconLink} ${s.ghost} ${s.gRound}`} />
            <span className={`${s.ghost} ${s.gLogout}`} />
          </div>
        </div>
      </div>
      <div className={s.balanceRow}>
        <div className={s.balance}>
          <span className={`${s.ghost} ${s.gLabel}`} />
          <span className={s.amounts}>
            <GhostAmount />
            <GhostAmount />
          </span>
        </div>
        <span className={`${s.ghost} ${s.gPay}`} />
      </div>
    </div>
  );
}

function GhostAmount() {
  return <span className={`${s.ghost} ${s.gAmount}`} />;
}
