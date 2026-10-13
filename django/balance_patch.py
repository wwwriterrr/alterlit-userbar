# Баланс в реальном времени: события в личный поток пользователя ws/chat/stream/
# (группа chat_user_<id>, та же, что у чата и счётчиков). Баланс общий для обоих
# сайтов, поэтому события идут во все вкладки пользователя, без деления по request.mode.
#
#   {"message": {"type": "balance", "balance": {"lits": 430.0, "books": 2.0}}}
#       — баланс изменился (транзакция создана, изменена или удалена — в литах или буках).
#         Готовые числа в том же виде, что у GET /api/v1/users/balance/; виджет их ставит.
#
#   {"message": {"type": "transaction", "action": "created" | "updated" | "deleted",
#                "transaction": {"id": 77, "currency": "lits" | "books", "amount": 300.0,
#                                "reason": 6, "reason_label": "Пополнение баланса",
#                                "comment": "Баланс пополнен", "date": "2026-10-13T15:20:00+03:00"}}}
#       — что именно произошло: для страницы финансов, всплывашек и т. п.
#         comment может содержать HTML (перевод пользователю) — на фронте только через санитайзер.
#
#   {"message": {"type": "pay_order",
#                "order": {"id": 512, "status": "success" | "error" | "new", "currency": "lits",
#                          "total": 30.0, "dt_modified": "2026-10-13T15:20:00+03:00"}}}
#       — у заказа Робокассы сменился статус. Пригодится странице /pay/: «Оплата прошла».
#
# Порядок при оплате (RobokassaResult): pay_order(success) → transaction(created) → balance.
#
# Баланс в событии считается заново по транзакциям (как _calculate_balance) в момент
# коммита, а не берётся из profile: post_save у Transaction срабатывает внутри save(),
# ещё до self.user._calculate_balance(), и profile.balance там старый.
#
# ВАЖНО: QuerySet.update()/delete() и bulk_create() сигналов не шлют. Если где-то
# транзакции меняются пачкой — после неё вызовите push_balance(user_id).


# ── 1. alterlit/channels_utils.py ───────────────────────────────────────────
CHANNELS_MESSAGE_TYPES = {
    # ...существующие типы без изменений...
    'balance': 'balance',
    'transaction': 'transaction',
    'pay_order': 'pay_order',
}


# ── 2. altermoney/events.py (новый файл) ────────────────────────────────────
from django.db import transaction as db_transaction
from django.db.models import Sum

from alterlit.channels_utils import CHANNELS_MESSAGE_TYPES, send_to_users


def _num(value):
    # Decimal в слой каналов не пролезет (msgpack) — отдаём float, как ручка баланса
    return float(value or 0)


def _date(value):
    return value.isoformat() if value else None


def current_balance(user_id):
    """Баланс по транзакциям — те же правила, что у _calculate_balance: не ниже нуля."""
    from altermoney.models import Transaction, TransactionBooks

    def total(model):
        s = model.objects.filter(user_id=user_id).aggregate(s=Sum('amount'))['s']
        return max(_num(s), 0.0)

    return {'lits': total(Transaction), 'books': total(TransactionBooks)}


def transaction_to_json(t):
    from altermoney.models import TransactionBooks

    return {
        'id': t.id,
        'currency': 'books' if isinstance(t, TransactionBooks) else 'lits',
        'amount': _num(t.amount),
        'reason': t.reason,
        'reason_label': t.get_reason_display(),
        'comment': t.comment or '',
        'date': _date(t.date),
    }


def push_balance(user_id):
    """Актуальный баланс во все вкладки пользователя — после коммита транзакции БД."""
    def _send():
        send_to_users([user_id], {
            'type': CHANNELS_MESSAGE_TYPES['balance'],
            'balance': current_balance(user_id),
        })
    db_transaction.on_commit(_send)


def push_transaction(t, action):
    """Событие о транзакции и следом — новый баланс."""
    payload = {
        'type': CHANNELS_MESSAGE_TYPES['transaction'],
        'action': action,
        # снимок сейчас: после post_delete объекта в БД уже нет
        'transaction': transaction_to_json(t),
    }
    user_id = t.user_id
    db_transaction.on_commit(lambda: send_to_users([user_id], payload))
    push_balance(user_id)


def push_pay_order(order):
    if not order.user_id:  # гостевой заказ (предзаказ книги) — слать некому
        return
    payload = {
        'type': CHANNELS_MESSAGE_TYPES['pay_order'],
        'order': {
            'id': order.id,
            'status': order.status,
            'currency': order.currency,
            'total': _num(order.total),
            'dt_modified': _date(order.date_modified),
        },
    }
    user_id = order.user_id
    db_transaction.on_commit(lambda: send_to_users([user_id], payload))


# ── 3. altermoney/models.py — в конец файла ─────────────────────────────────
# Существующие сигналы (проверка на минус, уведомления MN, пересчёт) не трогаем —
# это отдельные получатели.
from altermoney.events import push_pay_order, push_transaction


@receiver(post_save, sender=Transaction)
@receiver(post_save, sender=TransactionBooks)
def push_transaction_saved(sender, instance, created, **kwargs):
    push_transaction(instance, 'created' if created else 'updated')


@receiver(post_delete, sender=Transaction)
@receiver(post_delete, sender=TransactionBooks)
def push_transaction_deleted(sender, instance, **kwargs):
    push_transaction(instance, 'deleted')


@receiver(pre_save, sender=RobokassaOrder)
def order_remember_status(sender, instance, **kwargs):
    instance._old_status = (RobokassaOrder.objects.filter(pk=instance.pk)
                            .values_list('status', flat=True).first()) if instance.pk else None


@receiver(post_save, sender=RobokassaOrder)
def push_order_status(sender, instance, created, **kwargs):
    # создаёт заказ сам пользователь — сообщаем только о смене статуса (оплата, ошибка)
    if not created and instance.status != getattr(instance, '_old_status', None):
        push_pay_order(instance)
