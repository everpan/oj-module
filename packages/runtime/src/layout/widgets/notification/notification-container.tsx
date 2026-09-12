import type { ButtonProps } from "antd";
import type { NotificationsApiProvider } from "#src/store/api-provider";
import type { NotificationEventType } from "./index";
import type { NotificationItem } from "./types";

import { useCallback, useEffect, useState } from "react";

import { fetchNotifications } from "#src/api/notifications";
import { getNotificationsApiProvider } from "#src/store/api-provider";
import { NotificationPopup } from "./index";

/** 版本漂移（评审 P2-7）：缺写方法的老 bundle provider 只 warn 一次 */
const warnedStaleProviders = new Set<string>();

/**
 * 通知容器（G4）：拉取列表 + 接线互动事件。
 *
 * - 互动可用的前提：注册了 provider 且四方法齐全；否则降级只读
 *   （popup 按 onEventChange 是否存在推导，评审 A3——不加新 prop）；
 * - 写操作成功后重拉刷新；**重拉失败不清空现有列表**（评审 b4）；
 * - 20x 复制残留已删除（评审 b4，同一 id 复制 20 份会让 markRead 语义失真）；
 * - viewAll 不接线（N3，模板无通知中心页）。
 */
export function NotificationContainer({ ...restProps }: ButtonProps) {
	const [notifications, setNotifications] = useState<NotificationItem[]>([]);

	const provider = getNotificationsApiProvider();
	// 版本漂移防御（评审 P2-7）：老 bundle 的 provider 可能只有 fetchNotifications，
	// TS 类型保证不了运行时形状，逐方法 typeof 检查
	const staleSafe = provider as Partial<NotificationsApiProvider> | undefined;
	const interactive = Boolean(
		staleSafe?.fetchNotifications
		&& staleSafe.markRead
		&& staleSafe.markAllRead
		&& staleSafe.clearAll,
	);
	if (provider && !interactive && !warnedStaleProviders.has("notifications")) {
		warnedStaleProviders.add("notifications");
		console.warn(
			"[notification] 已注册的通知 provider 缺少写方法（markRead/markAllRead/clearAll），"
			+ "疑似老版本模块 bundle；通知降级为只读展示。",
		);
	}

	const reload = useCallback(() => {
		fetchNotifications()
			.then((res) => {
				// 防御：接口异常/返回结构不符时 res 可能不是数组，
				// 直接渲染会产出 undefined 元素，导致 NotificationPopup 读取
				// item.isRead 时崩溃（连带整块布局落到 error boundary）。
				setNotifications(Array.isArray(res) ? res : []);
			})
			.catch(() => {
				// 重拉失败保持现有列表，不清空（评审 b4）
			});
	}, []);

	useEffect(() => {
		reload();
	}, [reload]);

	const handleEventChange = interactive
		? (event: NotificationEventType, item?: NotificationItem) => {
			const p = provider;
			if (!p)
				return;
			const action = event === "read"
				? () => p.markRead(item!.id)
				: event === "makeAll"
					? () => p.markAllRead()
					: event === "clear"
						? () => p.clearAll()
						: undefined; // viewAll 不接线（N3）
			action?.()
				.then(reload)
				.catch(() => {
					// 写失败保持列表原状；错误提示归 provider 侧（BDD 5.3#5）
				});
		}
		: undefined;

	return (
		<NotificationPopup
			notifications={notifications}
			onEventChange={handleEventChange}
			{...restProps}
		/>
	);
}
