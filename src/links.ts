let site = '';

export function configureLinks(prefix: string) {
  site = prefix.replace(/\/$/, '');
}

const u = (path: string) => site + path;

/** Ссылки на страницы сайта. */
export const links = {
  profile: (username: string) => u(`/profile/${encodeURIComponent(username)}/`),
  notifications: (username: string) => u(`/profile/${encodeURIComponent(username)}/?page=notifications`),
  // сообщения: администрации — новый чат (/messenger/), остальным пока старая страница
  messages: (isStaff = false) => u(isStaff ? '/messenger/' : '/messages/all/'),
  logout: () => u('/logout/'),
  finance: () => u('/finance/'),
  pay: () => u('/pay/?currency=lits'),
  newPost: () => u('/post/new/'),
};
