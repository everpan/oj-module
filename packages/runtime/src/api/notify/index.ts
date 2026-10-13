import type {
	NoticeCategory,
	NoticeItem,
	PushBroadcastInput,
	PushInput,
} from "@oj-module/runtime/notify";

import { getNotificationsApiProvider } from "#src/store/api-provider";

export type {
	NoticeCategory,
	NoticeItem,
	PushBroadcastInput,
	PushInput,
};

const NOT_REGISTERED = "NotificationsBackendNotRegistered";

function requirePushProvider() {
	const p = getNotificationsApiProvider();
	if (!p || typeof p.push !== "function" || typeof p.pushBroadcast !== "function" || typeof p.del !== "function")
		throw new Error(`[notify] ${NOT_REGISTERED}：未注册 notificationsApi provider 的发射方法（push/pushBroadcast/del）。`);
	return p;
}

/**
 * 跨模块通知发射原语（前端侧 facade）。委托给已注册 notificationsApi provider 的
 * 发射方法（经 HTTP 落到后端通知模块）。后端模块请改用 `api/src/_shared/notify`
 * （直接 db 写入两表）——那是真正的服务端原语。
 *
 * 语义：原语不做任何业务判断（不判空间/角色/可见性），收件人过滤是发送方责任。
 */
export const notify = {
	/** 给指定用户推一条按人通知，返回命名空间 id "u:<id>" */
	push(input: PushInput): Promise<string> {
		return requirePushProvider().push(input);
	},
	/** 广播一条通知（全员可见，一行存储），返回命名空间 id "b:<id>" */
	pushBroadcast(input: PushBroadcastInput): Promise<string> {
		return requirePushProvider().pushBroadcast(input);
	},
	/** 删除通知：按人项校验归属（非本人删自己）；广播项仅删本人回执 */
	del(id: string, userId: string | number): Promise<void> {
		return requirePushProvider().del(id, userId);
	},
};
