import { ExclamationCircleFilled } from "@ant-design/icons";

import { isObject } from "#src/utils/is";
import { modal } from "#src/utils/static-antd";

/**
 * 首次登录强制改密（must_change）的统一拦截
 *
 * 后端对「未改密」账号的每一个管理接口都返回 403
 * `{ code: "must_change", msg: "password change required" }`。
 * 若由各页面各自弹错，进入任一管理页会瞬间刷出数条重复报错，
 * 再等 query 落定才慢慢浮出改密引导——体验极差。
 *
 * 处理策略（两层）：
 * 1. 主动层：user store 拉取 `/web/user-info` 得知 `mustChange` 后**立即**
 *    弹出本引导框，不等用户去点管理页踩 403（见 store/user.ts）；
 * 2. 兜底层：万一仍有管理接口先 403（如主动层弹窗前已发出的并发请求），
 *    请求层在此拦截，抑制逐条 toast。
 *
 * 弹窗为「阻塞性」：无取消/关闭按钮、点遮罩不关，用户必须去改密，
 * 从而真正「阻止操作」，而非刷完报错再放用户进系统。
 */

let mustChangeModalOpen = false;

export function isMustChange(data: unknown): boolean {
	if (isObject(data)) {
		const json = data as { code?: string, msg?: string };
		if (json.code === "must_change")
			return true;
		return (json.msg ?? "").includes("password change required");
	}
	return false;
}

export function openMustChangeModal() {
	if (mustChangeModalOpen) {
		return;
	}
	// 已在改密页：避免「弹窗 → 跳转改密页 → 重拉 user-info → 又弹窗」死循环
	if (location.pathname.endsWith("/change-password")) {
		return;
	}
	mustChangeModalOpen = true;
	modal.confirm({
		title: "需要修改密码",
		icon: <ExclamationCircleFilled />,
		content: "出于安全策略，当前账号要求首次登录后修改密码。请先完成密码修改，再继续使用系统功能。",
		okText: "去修改密码",
		closable: false,
		maskClosable: false,
		cancelButtonProps: { style: { display: "none" } },
		onOk: () => {
			// 与 goLogin 同套路：用 window.location 而非 router.navigate，
			// 以兼容 shell 自建 router 与模板 router 非同一实例的情况（浏览器路由模式）
			window.location.href = `${import.meta.env.BASE_URL}change-password`;
		},
		afterClose: () => {
			mustChangeModalOpen = false;
		},
	});
}
