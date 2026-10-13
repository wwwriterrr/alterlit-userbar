# Alterlit — блок пользователя

Блок пользователя в боковой панели alterlit.ru на React + TypeScript + Vite. В нём:

- аватар и имя со ссылкой на профиль. Значок у имени ставится как в чате: синий для администрации (`is_staff`), красный для владельца сайта;
- сообщения (пока ведут на старую страницу `/messages/all/`) и уведомления со счётчиками непрочитанного: до 9 показывается цифра, больше — белая точка в красном круге, точное число видно в подсказке. Счётчики обновляются в реальном времени;
- по клику на колокольчик открывается окно непрочитанных уведомлений со ссылкой «Все уведомления». При открытии они сразу отмечаются прочитанными, до id самого нового показанного: пришедшее позже не теряется. Если непрочитанных нет, колокольчик просто ведёт на страницу всех уведомлений. Окно выезжает справа поверх сайдбара: на десктопе шириной с сайдбар, до 1024px — 300px, до 600px — на весь экран;
- «Выход» — это ссылка на `/logout/`;
- баланс в литах и буках со ссылкой на `/finance/` и кнопка «Пополнить», ведущая на `/pay/?currency=lits`.

## Данные

| Что | Ручка |
|---|---|
| пользователь | `GET /api/v1/users/session/self/` (та же, что у чата) |
| баланс | `GET /api/v1/users/balance/` → `{lits, books}` |
| непрочитанные сообщения | `GET /api/v1/chat/unread/` → `{unread, rooms}` |
| непрочитанные уведомления | `GET /api/v1/users/session/notifications/unread/` → `{unread}` |
| список уведомлений | `GET /api/v1/users/session/notifications/?all=1&offset&limit` → `{objects, more, offset, unread}`; без `all` — только непрочитанные |
| прочитать | `POST /api/v1/users/session/notifications/read/` `{up_to}` → `{marked, unread}` |

Обновления приходят через личный поток пользователя `ws/chat/stream/` (тот же, что у чата):

- `new_notification {notification}` приходит при создании уведомления, в том числе через админку. Блок прибавляет 1, если уведомление не прочитано. Объект уведомления пригодится позже;
- `notifications_count {unread}` содержит готовое число. Оно приходит, когда уведомление прочитано, изменено или удалено;
- оба события сервер присылает только вкладкам того сайта, которому уведомление показывается: на alterlit — `site` AL и ALL, на altcg — ALT и ALL. Сайт сокета определяется по `Host`, как `request.mode` у HTTP;
- на события чата (`new_message` от собеседника, `remove_message`, `room_read`, `room_deleted`, `room_restored`) блок перезапрашивает счётчик сообщений. Пачка событий подряд даёт один запрос;
- после обрыва сокета и после возвращения на вкладку, скрытую дольше минуты, блок сверяет все счётчики и баланс.

При каждом изменении счётчиков блок шлёт событие `window` `alterlit:unread` с `detail: {messages, notifications}`. Его может слушать старый код сайта, например точка на мобильной кнопке меню.

Бэкенд описан в [django/counters_patch.py](django/counters_patch.py), [django/notifications_panel_patch.py](django/notifications_panel_patch.py) и [django/site_mode_patch.py](django/site_mode_patch.py).

## Разработка

```bash
npm install
cp .env.example .env.local   # BACKEND_URL и DEV_COOKIE — как у чата
npm run dev                  # http://localhost:5174 — блок на фоне сайдбара сайта
```

## Сборка и подключение

```bash
npm run build   # dist/userbar.js и dist/userbar.css, имена статические
```

Содержимое `dist/` выкладывается в `/assets/userbar/`. В шаблоне сайта блок `<div id="user">…</div>` для авторизованных пользователей заменяется на:

```html
<div id="alterlit-userbar"></div>
<link rel="stylesheet" href="/assets/userbar/userbar.css?v=1.00">
<script type="module" src="/assets/userbar/userbar.js?v=1.00"></script>
```

`?v=` нужно увеличивать при каждой выкладке. POST отправляет токен из куки `csrftoken`; если на страницах её нет, передайте токен атрибутом `data-csrf="{{ csrf_token }}"`. Атрибут `data-site` у `#alterlit-userbar` задаёт префикс ссылок; на сайте он не нужен.
