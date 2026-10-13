// Даты с сервера — без смещения, по Москве (как в чате): «2026-10-13T11:54:29.920899».
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «сегодня, 11:54», «вчера, 23:10», «3 октября, 09:15», «3 октября 2025, 09:15» */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, hh, mm] = m;
  const time = `${hh}:${mm}`;
  // «сегодня/вчера» — по московскому календарю, чтобы совпадало с датой сервера
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + 3 * 3600_000 - 86400_000).toISOString().slice(0, 10);
  const day = `${y}-${mo}-${d}`;
  if (day === today) return `сегодня, ${time}`;
  if (day === yesterday) return `вчера, ${time}`;
  const year = y === today.slice(0, 4) ? '' : ` ${y}`;
  return `${Number(d)} ${MONTHS[Number(mo) - 1]}${year}, ${time}`;
}
