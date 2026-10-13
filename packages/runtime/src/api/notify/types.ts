// 跨模块通知原语的公共类型（runtime 契约层）。后端模块 import 这些类型 +
// api/src/_shared/notify（db 实现）；前端模块经 @oj-module/runtime 的 notify facade。

/** 消息类别：notice=通知/广播，pm=私信（按人），mention=@我（占位） */
export type NoticeCategory = "notice" | "pm" | "mention";

/** 铃展示项。id 为命名空间串："u:<id>" 按人 / "b:<id>" 广播 */
export interface NoticeItem {
	id: string
	scope: "user" | "broadcast"
	avatar: string
	date: string
	isRead?: boolean
	message: string
	title: string
	link?: string
	category?: NoticeCategory
}

/** 给指定用户推一条按人通知 */
export interface PushInput {
	userId: string | number
	title: string
	message: string
	link?: string
	avatar?: string
	category?: NoticeCategory
}

/** 广播一条通知（全员可见，一行存储） */
export interface PushBroadcastInput {
	title: string
	message: string
	link?: string
	avatar?: string
	category?: NoticeCategory
}
