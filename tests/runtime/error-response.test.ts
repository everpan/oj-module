/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleErrorResponse } from "#src/utils/request/error-response";

const messageError = vi.hoisted(() => vi.fn());
const modalConfirm = vi.hoisted(() => vi.fn());

vi.mock("#src/utils/static-antd", () => ({ message: { error: messageError }, modal: { confirm: modalConfirm } }));

/**
 * 错误响应体不保证是 JSON（ojm dev 404 纯文本、网关 502 HTML 都是常态）。
 * BDD 用例见 docs/prd/202608312235-error-response-non-json-fix.md。
 */
describe("handleErrorResponse 错误体解析", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		messageError.mockClear();
	});

	it("t1: 非 JSON 404 不刷 console.error，回退 statusText", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = new Response("404 Not Found: /api/notifications", {
			status: 404,
			statusText: "Not Found",
		});

		await handleErrorResponse(res);

		expect(consoleError).not.toHaveBeenCalled();
		expect(messageError).toHaveBeenCalledWith("Not Found");
	});

	it("t2: oj 信封错误体读 msg 键（AC-D16）", async () => {
		const res = new Response(JSON.stringify({ code: 400, msg: "boom", data: null }), {
			status: 400,
			statusText: "Bad Request",
			headers: { "content-type": "application/json" },
		});

		await handleErrorResponse(res);

		expect(messageError).toHaveBeenCalledWith("boom");
	});

	it("t2b: 旧 message/errorMsg 键不再读取（AC-D16 兼容删除）", async () => {
		const res = new Response(JSON.stringify({ message: "old key" }), {
			status: 400,
			statusText: "Bad Request",
			headers: { "content-type": "application/json" },
		});

		await handleErrorResponse(res);

		expect(messageError).toHaveBeenCalledWith("Bad Request");
	});

	it("t3: 返回的 response body 仍可读（原 body 未被消费）", async () => {
		const res = new Response("502 Bad Gateway", { status: 502, statusText: "Bad Gateway" });

		const returned = await handleErrorResponse(res);

		await expect(returned.text()).resolves.toBe("502 Bad Gateway");
	});

	/**
	 * 403 抑制全局 toast（BDD 见 docs/prd/202610222046-403-forbidden-fast-path.md）：
	 * 无权页面的并发 query 各刷一条 toast 再渲染「无权限」面板 = 双重反馈刷屏；
	 * 页面层 isForbidden → ForbiddenPanel / onError explainError 自行消化，
	 * 与 must_change 的抑制策略同层同理。
	 */
	describe("403 抑制全局 toast（AC-403）", () => {
		it("AC-403-1: 信封 403 不 toast，body 仍可读", async () => {
			const res = new Response(JSON.stringify({ code: 403, msg: "forbidden", data: null }), {
				status: 403,
				statusText: "Forbidden",
				headers: { "content-type": "application/json" },
			});

			const returned = await handleErrorResponse(res);

			expect(messageError).not.toHaveBeenCalled();
			await expect(returned.json()).resolves.toMatchObject({ code: 403 });
		});

		it("AC-403-1b: 非 JSON 体 403 同样不 toast", async () => {
			const res = new Response("403 Forbidden", { status: 403, statusText: "Forbidden" });

			await handleErrorResponse(res);

			expect(messageError).not.toHaveBeenCalled();
		});

		it("AC-403-2: must_change 403 维持引导弹窗、不 toast", async () => {
			const res = new Response(
				JSON.stringify({ code: 403, msg: "password change required", data: { code: "must_change" } }),
				{ status: 403, statusText: "Forbidden", headers: { "content-type": "application/json" } },
			);

			await handleErrorResponse(res);

			expect(messageError).not.toHaveBeenCalled();
			expect(modalConfirm).toHaveBeenCalledOnce();
		});
	});
});
