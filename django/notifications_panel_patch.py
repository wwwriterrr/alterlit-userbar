# Окно уведомлений в блоке пользователя: список и «прочитать всё».
#
#   GET  /api/v1/users/session/notifications/?offset=0&limit=30          — непрочитанные
#   GET  /api/v1/users/session/notifications/?all=1&offset=0&limit=30    — все
#        → {"objects": [уведомление, …], "more": bool, "offset": n, "unread": n}
#          уведомление — NotificationSerializer: {id, status, content, is_read, date, site}
#          новые сверху; unread — сколько непрочитанных всего (для счётчика)
#
#   POST /api/v1/users/session/notifications/read/   {"up_to": 6148745}
#        → {"marked": n, "unread": n}
#        Отмечает прочитанными непрочитанные с id <= up_to — то есть всё, что окно
#        показало, и всё, что старше. Уведомление, пришедшее между загрузкой списка
#        и этим запросом, остаётся непрочитанным: пользователь его ещё не видел.
#        Без up_to — все непрочитанные.
#
# Обе ручки — только уведомления сайта запроса (request.mode): alterlit — AL/ALL,
# altcg — ALT/ALL. Аноним — 403, POST — с X-CSRFToken (SessionAuthentication).
#
# После прочтения во все вкладки уходит notifications_count — счётчики обнуляются везде.
# update() сигналов не шлёт, поэтому push_notifications_count вызывается явно.


# ── 1. api/notification/notifications.py — добавить ────────────────────────
def notifications_for(user_id, mode, unread_only=True):
    """Уведомления пользователя для сайта mode, новые сверху."""
    qs = Notification.objects.filter(to_id=user_id, site__in=SITES_BY_MODE[mode])
    if unread_only:
        qs = qs.filter(is_read=False)
    # id — второй ключ: у уведомлений, созданных в одну транзакцию, date может совпасть
    return qs.order_by('-date', '-id')


def mark_notifications_read(user_id, mode, up_to=None):
    """Отметить прочитанными непрочитанные уведомления сайта (с id <= up_to). -> сколько."""
    qs = notifications_for(user_id, mode)
    if up_to is not None:
        qs = qs.filter(id__lte=up_to)
    marked = qs.update(is_read=True)
    if marked:
        # среди прочитанных могут быть site=ALL — они видны и на другом сайте,
        # поэтому пересчитываем для всех (каждая группа получает своё число)
        push_notifications_count(user_id)
    return marked


# ── 2. api/notification/views.py ────────────────────────────────────────────
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.notification.notifications import (
    mark_notifications_read,
    notifications_for,
    request_mode,
    unread_notifications_count,
)
from api.notification.serializers import NotificationSerializer

NOTIFICATIONS_LIMIT = 30
NOTIFICATIONS_MAX_LIMIT = 100


def _int(value, default, minimum, maximum):
    """Целое из параметра запроса в границах. -> (значение, ошибка | None)."""
    if value in (None, ''):
        return default, None
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = None
    if number is None or not minimum <= number <= maximum:
        return None, f'Должно быть целым числом от {minimum} до {maximum}'
    return number, None


class NotificationList(APIView):
    """GET — непрочитанные уведомления сайта запроса; ?all=1 — все."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        offset, offset_error = _int(request.query_params.get('offset'), 0, 0, 100_000)
        limit, limit_error = _int(request.query_params.get('limit'), NOTIFICATIONS_LIMIT, 1, NOTIFICATIONS_MAX_LIMIT)
        errors = {k: [v] for k, v in (('offset', offset_error), ('limit', limit_error)) if v}
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        mode = request_mode(request)
        show_all = request.query_params.get('all') in ('1', 'true')
        qs = notifications_for(request.user.id, mode, unread_only=not show_all)

        found = list(qs[offset:offset + limit + 1])  # +1 — чтобы понять, есть ли ещё
        return Response({
            'objects': NotificationSerializer(found[:limit], many=True).data,
            'more': len(found) > limit,
            'offset': offset,
            'unread': unread_notifications_count(request.user.id, mode),
        })


class NotificationsRead(APIView):
    """POST {"up_to": id} — прочитать непрочитанные уведомления сайта запроса до id включительно."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        raw = request.data.get('up_to') if hasattr(request.data, 'get') else None
        up_to, error = _int(raw, None, 1, 2**63 - 1)
        if error:
            return Response({'up_to': [error]}, status=status.HTTP_400_BAD_REQUEST)

        mode = request_mode(request)
        marked = mark_notifications_read(request.user.id, mode, up_to)
        return Response({
            'marked': marked,
            'unread': unread_notifications_count(request.user.id, mode),
        })


# ── 3. Урлы /api/v1/ (рядом с notifications/unread/) ────────────────────────
#     from api.notification import views as notification_views
#
#     path('users/session/notifications/', notification_views.NotificationList.as_view(), name='users_notifications'),
#     path('users/session/notifications/read/', notification_views.NotificationsRead.as_view(), name='users_notifications-read'),
#
# (notifications/unread/ можно оставить в user_views или тоже перенести сюда)
