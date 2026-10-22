import type { NoticeCategory } from "@oj-module/runtime/notify";

import { CheckOutlined, ClearOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Avatar, Button, Empty, List, Popconfirm, Segmented, Tag, Tooltip } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
	notificationNotificationsClearPost,
	notificationNotificationsGet,
	notificationNotificationsReadAllPost,
	notificationNotificationsReadPost,
} from "../../__client/api";

type Item = Awaited<ReturnType<typeof notificationNotificationsGet>>[number];
type CatFilter = "all" | NoticeCategory;

const CAT_COLOR: Record<NoticeCategory, string> = {
	notice: "blue",
	pm: "magenta",
	mention: "orange",
};

/**
 * 通知中心（N3 落地）：全量消息页，铃铛弹层「查看全部」跳转至此。
 * 按类型（notice/pm/mention）Tab 过滤；单条点击标记已读并跳深链；
 * 全部已读/清空与铃铛弹层同一数据路径（/api/notification/*）。
 */
export default function NotificationCenter() {
	const { t } = useTranslation("notification");
	const { message } = App.useApp();
	const queryClient = useQueryClient();
	const [cat, setCat] = useState<CatFilter>("all");

	const { data, isPending } = useQuery({
		queryKey: ["notification-center"],
		queryFn: notificationNotificationsGet,
	});

	const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notification-center"] });

	const readMut = useMutation({
		mutationFn: (id: string) => notificationNotificationsReadPost({ id }),
		onSettled: invalidate,
		onError: e => message.error(String(e)),
	});
	const readAllMut = useMutation({
		mutationFn: notificationNotificationsReadAllPost,
		onSettled: invalidate,
		onError: e => message.error(String(e)),
	});
	const clearMut = useMutation({
		mutationFn: notificationNotificationsClearPost,
		onSettled: invalidate,
		onError: e => message.error(String(e)),
	});

	const items = (data ?? []).filter(x => cat === "all" || x.category === cat);

	const handleClick = (item: Item) => {
		if (!item.isRead)
			readMut.mutate(item.id);
		// 深链与铃铛弹层同约定：标记已读后新标签打开
		if (item.link)
			window.open(item.link, "_blank", "noopener");
	};

	const hasUnread = (data ?? []).some(x => !x.isRead);

	return (
		<div className="max-w-2xl mx-auto p-4">
			<div className="flex items-center justify-between mb-3">
				<Segmented
					value={cat}
					onChange={v => setCat(v as CatFilter)}
					options={[
						{ label: t("center.tabAll"), value: "all" },
						{ label: t("center.category.notice"), value: "notice" },
						{ label: t("center.category.pm"), value: "pm" },
						{ label: t("center.category.mention"), value: "mention" },
					]}
				/>
				<div className="flex items-center gap-2">
					<Tooltip title={hasUnread ? t("center.markAllRead") : null}>
						<Button
							disabled={!hasUnread || readAllMut.isPending}
							icon={<CheckOutlined />}
							onClick={() => readAllMut.mutate()}
						>
							{t("center.markAllRead")}
						</Button>
					</Tooltip>
					<Popconfirm title={t("center.clearConfirm")} onConfirm={() => clearMut.mutate()}>
						<Button danger disabled={!(data ?? []).length || clearMut.isPending} icon={<ClearOutlined />}>
							{t("center.clear")}
						</Button>
					</Popconfirm>
				</div>
			</div>
			<List
				loading={isPending}
				itemLayout="horizontal"
				locale={{ emptyText: <Empty description={t("center.empty")} /> }}
				dataSource={items}
				renderItem={item => (
					<List.Item className="cursor-pointer hover:bg-gray-100" onClick={() => handleClick(item)}>
						<List.Item.Meta
							avatar={<Avatar src={item.avatar || undefined}>{item.title.slice(0, 1)}</Avatar>}
							title={(
								<span className="flex items-center gap-2">
									{!item.isRead && <span className="w-2 h-2 rounded bg-blue-600 inline-block shrink-0" />}
									<span className="font-semibold">{item.title}</span>
									<Tag color={CAT_COLOR[item.category ?? "notice"]}>
										{t(`center.category.${item.category ?? "notice"}`)}
									</Tag>
								</span>
							)}
							description={(
								<div className="flex flex-col gap-1">
									<span>{item.message}</span>
									<span className="text-xs text-muted-foreground">{item.date}</span>
								</div>
							)}
						/>
					</List.Item>
				)}
			/>
		</div>
	);
}
