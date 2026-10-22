import { isObject } from "#src/utils/is";
import { message } from "#src/utils/static-antd";

import { isMustChange, openMustChangeModal } from "./must-change";

/**
 * 处理错误响应
 *
 * 错误体不保证是 JSON（ojm dev 404 纯文本、网关 502 HTML 都是常态），
 * 故对齐 ky 自家的 text-first 模式：先取文本再显式 JSON.parse，
 * 解析不出对象就静默回退状态文本——非 JSON 不再当异常刷 console.error。
 * 经 clone 读取，保持原 body 对下游（ky .json() 链）可读。
 *
 * @param response 响应对象
 * @returns 响应对象
 */
export async function handleErrorResponse(response: Response) {
	const text = await response.clone().text().catch(() => "");

	let data: unknown;
	try {
		data = JSON.parse(text);
	}
	catch {
		// 非 JSON 错误体（常态），展示状态文本即可
	}

	if (isObject(data)) {
		// 未改密（must_change）集中拦截：不逐条 toast，改弹一次引导框
		if (isMustChange(data)) {
			openMustChangeModal();
			return response;
		}
		// 403 抑制逐条 toast（与 must_change 同理）：无权页面的并发 query 由
		// 页面层 isForbidden → ForbiddenPanel 消化，mutation 由 onError explainError
		// 反馈，全局 toast 只会刷屏（见 docs/prd/202610222046-403-forbidden-fast-path.md）
		if (response.status === 403)
			return response;
		// AC-D16：全站唯一信封 = oj {code,msg,data}，错误体只读 msg 键
		const json = data as { msg?: string };
		message.error(json.msg || response.statusText);
	}
	else {
		// 非 JSON 错误体（常态），展示状态文本即可
		if (response.status !== 403)
			message.error(response.statusText);
	}

	return response;
}
