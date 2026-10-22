# Уведомления открываются долго у тех, у кого их много (активные авторы, редакция).
#
# Почему. У blog.Notification только одиночные индексы: to, status, is_read, date, site. Все запросы
# уведомлений — «уведомления одного человека, новые сверху»:
#
#   панель юзербара     WHERE to_id=? AND site IN (…) [AND is_read=0] ORDER BY date DESC, id DESC LIMIT 21
#   счётчик             WHERE to_id=? AND is_read=0 AND site IN (…)                 → COUNT(*)
#   «прочитать»         UPDATE … WHERE to_id=? AND is_read=0 AND site IN (…) AND id <= ?
#   старая страница     Notification.get_notif(user, limit=60, read=True, site=…) + UPDATE всех непрочитанных
#
# MySQL берёт индекс to_id, достаёт ВСЕ уведомления человека (у активного автора — десятки тысяч строк)
# и сортирует их по дате в памяти (filesort), чтобы отдать первые 20–60. Чем больше уведомлений,
# тем дольше — у тестового пользователя с сотней уведомлений всё летает (20–50 мс), а жалуются те,
# у кого их много.
#
# Что сделать. Два составных индекса — по ним MySQL сразу читает нужные строки в порядке даты и
# останавливается на LIMIT (в индекс InnoDB неявно входит id, поэтому ORDER BY date, id тоже по нему):
#
#   (to, date)           — «все уведомления», старая страница
#   (to, is_read, date)  — непрочитанные: панель, счётчик, «прочитать»
#
# Миграция только добавляет индексы — данные не меняются, старый код работает как раньше.


# ── 1. blog/models.py, class Notification — в Meta добавить indexes ────────────
class Meta:
    ordering = ["-date"]
    get_latest_by = "date"
    verbose_name = "уведомление"
    verbose_name_plural = "уведомления"
    indexes = [
        models.Index(fields=["to", "date"], name="notif_to_date"),
        models.Index(fields=["to", "is_read", "date"], name="notif_to_unread_date"),
    ]

# Потом:  python manage.py makemigrations blog  &&  python manage.py migrate blog
#
# На большой таблице MySQL 8 / MariaDB 10.3+ создают индекс без блокировки записи (online DDL),
# но займёт время — лучше в спокойные часы. Сколько строк:
#     SELECT COUNT(*) FROM blog_notification;


# ── 2. Проверка «до» и «после» (MySQL, только чтение) ──────────────────────────
# У кого больше всего уведомлений — на них и смотреть:
#
#     SELECT to_id, COUNT(*) n FROM blog_notification GROUP BY to_id ORDER BY n DESC LIMIT 5;
#
# План запроса панели для такого пользователя (подставьте его id):
#
#     EXPLAIN SELECT id FROM blog_notification
#     WHERE to_id = <id> AND site IN ('AL','ALL')
#     ORDER BY date DESC, id DESC LIMIT 21;
#
# До: key = to_id (или blog_notification_to_id_…), Extra: «Using filesort», rows ≈ все его уведомления.
# После: key = notif_to_date, без filesort, rows — порядка LIMIT.
#
#     EXPLAIN SELECT COUNT(*) FROM blog_notification
#     WHERE to_id = <id> AND is_read = 0 AND site IN ('AL','ALL');
#
# После: key = notif_to_unread_date.


# ── 3. Старая страница /profile/<username>/?page=notifications ─────────────────
# Пришлите, пожалуйста, Notification.get_notif: если внутри список собирается в Python
# (list(...) или срез после выборки всех уведомлений), индексы его не спасут — нужен LIMIT в запросе.
# Ещё там на каждый заход выполняется
#     Notification.objects.filter(to=request.user, is_read=False).update(is_read=True)
# — с индексом (to, is_read, date) он быстрый.


# ── 4. Потом, необязательно ─────────────────────────────────────────────────────
# Одиночные индексы is_read, status, site почти бесполезны (2–9 значений на миллионы строк), а каждая
# вставка уведомления их обновляет. Когда новые индексы постоят и всё будет хорошо, их можно снять:
# db_index=True → убрать у status, is_read, site (и date — его покрывает notif_to_date только вместе с to,
# поэтому date оставить, если где-то есть выборки уведомлений всех пользователей по дате, например в админке).
