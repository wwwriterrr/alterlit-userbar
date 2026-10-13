import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import UserBar from './UserBar';
import { configureLinks } from './links';
import { setCsrfFallback } from './api';

// Шаблон Django ставит <div id="alterlit-userbar"> только авторизованным.
// data-site — префикс ссылок на сайт (по умолчанию пусто: тот же домен).
const rootEl = document.getElementById('alterlit-userbar');
if (rootEl) {
  configureLinks(rootEl.dataset.site ?? '');
  setCsrfFallback(rootEl.dataset.csrf ?? '');
  createRoot(rootEl).render(
    <StrictMode>
      <UserBar />
    </StrictMode>,
  );
}
