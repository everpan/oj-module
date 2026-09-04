import type { NotificationItem } from "#src/layout/widgets/notification/types";
import { getNotificationsApiProvider } from "#src/store/api-provider";
import { request } from "#src/utils/request";
import { unwrap } from "#src/utils/request/envelope";

// D9：消费点委托。未注册 notificationsProvider 时回落到内置 root 级 /notifications。
export function fetchNotifications(): Promise<NotificationItem[]> {
	const p = getNotificationsApiProvider();
	if (p)
		return p.fetchNotifications();
	return unwrap(request
		.get("notifications")
		.json());
}
