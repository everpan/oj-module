import type { NoticeCategory } from "@oj-module/runtime/notify";

export interface NotificationItem {
	/**
	 * 必填——单条已读/清空等写操作的前提（G4）。现为命名空间串：
	 * "u:<id>" 按人（私信/@我），"b:<id>" 广播（通知/公告）。破坏性变更：由
	 * string|number 改为 string，发版说明标注（写操作须透传命名空间 id）。
	 */
	id: string
	/** 数据来源：user=按人项，broadcast=广播项 */
	scope: "user" | "broadcast"
	avatar: string
	date: string
	isRead?: boolean
	message: string
	title: string
	/** 深链：前端点击跳转 */
	link?: string
	/** 消息类别：notice=通知/广播，pm=私信，mention=@我（占位） */
	category?: NoticeCategory
}
