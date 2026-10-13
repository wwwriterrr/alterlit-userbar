# Блок пользователя в сайдбаре: счётчики непрочитанного в реальном времени.
#
#   GET /api/v1/chat/unread/                          → {"unread": 12, "rooms": 3}
#        unread — непрочитанные сообщения во всех чатах (как сумма unread_count в /rooms/),
#        rooms  — в скольких чатах они есть. Удалённые пользователем чаты не считаются.
#   GET /api/v1/users/session/notifications/unread/   → {"unread": 104}
#        непрочитанные уведомления сайта, с которого пришёл запрос (request.mode):
#        alterlit — site AL или ALL, altcg — ALT или ALL.
#   Аноним — 403.
#
# Живое обновление идёт через тот же личный поток, что слушает чат, — ws/chat/stream/
# (группа chat_user_<id>). Новые события:
#
#   {"message": {"type": "new_notification",
#                "notification": {"id": 9, "status": "C", "content": "…", "is_read": false,
#                                 "date": "2026-10-13T12:00:00", "site": "AL"}}}
#       — создано уведомление (в том числе в админке). Виджет прибавляет 1 к счётчику.
#         Сам объект пригодится позже — например, для всплывающей карточки.
#
#   {"message": {"type": "notifications_count", "unread": 104}}
#       — уведомление прочитано, изменено или удалено: готовое число, виджет его ставит.
#
# Оба события получают только вкладки сайтов, которым уведомление показывается:
# site AL → alterlit, ALT → altcg, ALL → оба; число в notifications_count — своё для
# каждого сайта (alterlit считает AL+ALL, altcg — ALT+ALL), как в HTTP-ручке по request.mode.
#
# Мидлвара с request.mode работает только для HTTP — в сокет она не попадает. Поэтому
# личный поток при подключении сам определяет сайт по заголовку Host (scope_mode, п. 4)
# и вступает в группу уведомлений своего сайта: notifications_<mode>_<user_id>.
#
# Счётчик сообщений виджет перезапрашивает сам на уже существующие события чата
# (new_message, room_read, room_deleted, …) — для него бэкенд менять не нужно.
#
# ВАЖНО: QuerySet.update() и bulk_create() сигналов не шлют. Там, где уведомления
# отмечаются прочитанными пачкой (`.filter(...).update(is_read=True)` — например,
# в обработчике method=get-notif у профиля), после update добавьте:
#
#     push_notifications_count(request.user.id, [request_mode(request)])
#
# Если где-то уведомления создаются через bulk_create — для каждого созданного
# вызовите push_new_notification(n) (или один push_notifications_count, если объекты не нужны).


# ── 1. alterlit/channels_utils.py ───────────────────────────────────────────
CHANNELS_MESSAGE_TYPES = {
    # ...существующие типы без изменений...
    'new_notification': 'new_notification',
    'notifications_count': 'notifications_count',
}


def notifications_group(user_id, mode):
    """Уведомления пользователя для одного сайта (alterlit | altcg)."""
    return f'notifications_{mode}_{user_id}'


def send_to_group(group_name, message):
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(group_name, {'type': 'chat.message', 'message': message})


# ── 2. api/notification/serializers.py ──────────────────────────────────────
from rest_framework import serializers

from blog.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'status', 'content', 'is_read', 'date', 'site']
        read_only_fields = fields


# ── 3. api/notification/notifications.py ────────────────────────────────────
from django.db import transaction

from blog.models import Notification
from alterlit.channels_utils import send_to_group, notifications_group, CHANNELS_MESSAGE_TYPES

# какие уведомления видит каждый сайт; режим ставит мидлвара: request.mode
SITES_BY_MODE = {
    'alterlit': ('AL', 'ALL'),
    'altcg': ('ALT', 'ALL'),
}
DEFAULT_MODE = 'alterlit'


def request_mode(request):
    mode = getattr(request, 'mode', None)
    return mode if mode in SITES_BY_MODE else DEFAULT_MODE


def modes_for_site(site):
    """Сайты, которым показывается уведомление с этим site: AL → [alterlit], ALL → оба."""
    return [mode for mode, sites in SITES_BY_MODE.items() if site in sites]


def unread_notifications_count(user_id, mode=DEFAULT_MODE):
    return Notification.objects.filter(to_id=user_id, is_read=False, site__in=SITES_BY_MODE[mode]).count()


def push_new_notification(notification):
    """Новое уведомление — во вкладки тех сайтов, где оно видно, после коммита транзакции."""
    from api.notification.serializers import NotificationSerializer  # избегаем цикличного импорта

    def _send():
        payload = {
            'type': CHANNELS_MESSAGE_TYPES['new_notification'],
            'notification': NotificationSerializer(notification).data,
        }
        for mode in modes_for_site(notification.site):
            send_to_group(notifications_group(notification.to_id, mode), payload)
    transaction.on_commit(_send)


def push_notifications_count(user_id, modes=None):
    """Актуальный счётчик — каждому сайту из modes своё число (по умолчанию — всем)."""
    modes = list(SITES_BY_MODE) if modes is None else modes

    def _send():
        for mode in modes:
            send_to_group(notifications_group(user_id, mode), {
                'type': CHANNELS_MESSAGE_TYPES['notifications_count'],
                'unread': unread_notifications_count(user_id, mode),
            })
    transaction.on_commit(_send)


# ── 4. blog/signals.py (рядом с сигналами Message) ──────────────────────────
from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver

from blog.models import Notification
from api.notification.notifications import modes_for_site, push_new_notification, push_notifications_count


@receiver(pre_save, sender=Notification)
def notification_remember_site(sender, instance, **kwargs):
    # site могут поменять в админке — тогда счётчик меняется и у прежнего сайта
    if instance.pk:
        instance._old_site = (Notification.objects.filter(pk=instance.pk)
                              .values_list('site', flat=True).first())


@receiver(post_save, sender=Notification)
def notification_saved(sender, instance, created, **kwargs):
    if created:
        push_new_notification(instance)
        return
    # «прочитано» и прочие правки — считаем заново, а не ±1
    modes = set(modes_for_site(instance.site)) | set(modes_for_site(getattr(instance, '_old_site', None)))
    push_notifications_count(instance.to_id, sorted(modes))


@receiver(post_delete, sender=Notification)
def notification_deleted(sender, instance, **kwargs):
    push_notifications_count(instance.to_id, modes_for_site(instance.site))


# ── 4а. blog/consumers.py — ChatStreamConsumer ──────────────────────────────
# Поток вступает ещё и в группу уведомлений своего сайта.
from alterlit.channels_utils import notifications_group


def scope_mode(scope):
    """
    Сайт, с которого открыт сокет, — та же логика, что у мидлвары с request.mode,
    только по заголовку Host из ASGI-scope. ВАЖНО: замените тело на вызов функции
    мидлвары (или повторите её правила), чтобы HTTP и сокет определяли сайт одинаково.
    """
    headers = dict(scope.get('headers') or [])
    host = headers.get(b'host', b'').decode('latin-1').split(':')[0].lower()
    return 'altcg' if 'altcg' in host else 'alterlit'


class ChatStreamConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if user is None or user.is_anonymous:
            await self.close(code=4001)
            return
        self.groups_joined = [user_group(user.id), notifications_group(user.id, scope_mode(self.scope))]
        for group in self.groups_joined:
            await self.channel_layer.group_add(group, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        for group in getattr(self, 'groups_joined', []):
            await self.channel_layer.group_discard(group, self.channel_name)

    # receive и chat_message — без изменений


# ── 5. api/user/views.py ────────────────────────────────────────────────────
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.notification.notifications import request_mode, unread_notifications_count


@api_view(['GET'])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
def notifications_unread(request):
    """Непрочитанные уведомления сайта, с которого пришёл запрос (request.mode)."""
    return Response({'unread': unread_notifications_count(request.user.id, request_mode(request))})


# ── 6. api/user/urls.py (подключён в /api/v1/users/) ────────────────────────
#     path('session/notifications/unread/', views.notifications_unread, name='notifications-unread'),
# Порядок: выше 'session/<int:pk>/' не обязательно — 'notifications' не int, но
# если там есть 'session/<str:...>/', ставьте этот путь раньше.


# ── 7. api/chat_legacy/views.py ─────────────────────────────────────────────
from django.db.models import Count
from blog.models import Room, Message


@api_view(['GET'])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
def unread_count(request):
    user = request.user
    # те же правила, что у unread_count в rooms_for: свои сообщения автор видит
    # прочитанными (is_read.add при отправке), удалённые чаты не считаются;
    # exclude по M2M is_read даёт корректный NOT IN
    my_rooms = (Room.objects
                .filter(members=user)
                .exclude(deleted_rooms__user=user)
                .values('pk'))
    stats = (Message.objects
             .filter(room__in=my_rooms)
             .exclude(is_read=user)
             .aggregate(unread=Count('pk'), rooms=Count('room', distinct=True)))
    return Response(stats)


# ── 8. api/chat_legacy/urls.py (подключён в /api/v1/chat/) ──────────────────
#     path('unread/', views.unread_count, name='chat-unread'),


# ── 9. Шаблон сайта: блок пользователя ──────────────────────────────────────
# Вместо содержимого <div id="user">…</div> (только для авторизованных):
#
#     <div id="alterlit-userbar"></div>
#
# В <head> (или перед </body>), ?v= — меняйте при каждой выкладке:
#
#     <link rel="stylesheet" href="/assets/userbar/userbar.css?v=1.00">
#     <script type="module" src="/assets/userbar/userbar.js?v=1.00"></script>
#
# Старый jQuery-опрос /checker/ ищет #msg и #ntf — их в новом блоке нет, поэтому
# счётчики он больше не запрашивает (ленту комнат и комментариев — по-прежнему).
# Всплывающая панель уведомлений (#notif) открывалась кликом по #ntf; теперь
# колокольчик ведёт на страницу уведомлений профиля.
#
# Точку «непрочитано» на мобильной кнопке меню ставил $._mob_check_unread по #msg/#ntf.
# Виджет при каждом изменении счётчиков шлёт событие окна — замените функцию на:
#
#     window.addEventListener('alterlit:unread', function (e) {
#         var d = e.detail;  // {messages: n, notifications: n}
#         $('#mob-menu-btn').toggleClass('unread', d.messages + d.notifications > 0);
#     });
