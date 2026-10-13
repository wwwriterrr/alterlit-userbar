# Определение сайта (alterlit | altcg) — одни правила для HTTP и для сокета.
#
# Список доменов AltCG живёт в settings.ALTCG_HOSTS. Мидлвара SetSiteMode (request.mode)
# и личный поток ws/chat/stream/ (группа уведомлений своего сайта) берут его оттуда,
# поэтому домен добавляется или убирается в одном месте.


# ── 1. settings.py ──────────────────────────────────────────────────────────
# Домены, на которых сайт работает как AltCG; все остальные — Альтерлит.
# Без порта, в нижнем регистре. www.altcg.ru убран — пусть редиректит на altcg.ru.
ALTCG_HOSTS = ['altcg.ru']


# ── 2. alterlit/site_mode.py (новый модуль) ─────────────────────────────────
from django.conf import settings

ALTERLIT = 'alterlit'
ALTCG = 'altcg'


def mode_for_host(host):
    """Сайт по домену запроса: 'altcg' для settings.ALTCG_HOSTS, иначе 'alterlit'.
    Порт отбрасывается (altcg.ru:8000 — тоже altcg)."""
    domain = (host or '').split(':')[0].strip().lower()
    return ALTCG if domain in settings.ALTCG_HOSTS else ALTERLIT


def mode_for_scope(scope):
    """То же для ASGI-scope (WebSocket): домен — из заголовка Host."""
    headers = dict(scope.get('headers') or [])
    return mode_for_host(headers.get(b'host', b'').decode('latin-1'))


# ── 3. Мидлвара SetSiteMode ─────────────────────────────────────────────────
from django.utils.deprecation import MiddlewareMixin

from alterlit.site_mode import mode_for_host


class SetSiteMode(MiddlewareMixin):
    def process_view(self, request, view_func, view_args, view_kwargs):
        mode = mode_for_host(request.get_host())
        request.mode = mode
        request.COOKIES['mode'] = mode


# ── 4. blog/consumers.py — ChatStreamConsumer ───────────────────────────────
# Функцию scope_mode из counters_patch.py удалить, вместо неё — общая:
#
#     from alterlit.site_mode import mode_for_scope
#
#     self.groups_joined = [user_group(user.id), notifications_group(user.id, mode_for_scope(self.scope))]


# ── 5. api/notification/notifications.py ────────────────────────────────────
# Названия режимов — из того же модуля, чтобы строки 'alterlit'/'altcg' не расходились:
#
#     from alterlit.site_mode import ALTERLIT, ALTCG
#
#     SITES_BY_MODE = {
#         ALTERLIT: ('AL', 'ALL'),
#         ALTCG: ('ALT', 'ALL'),
#     }
#     DEFAULT_MODE = ALTERLIT
