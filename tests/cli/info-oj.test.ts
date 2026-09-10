import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printInfo } from "../../packages/cli/src/info";
import { usageText } from "../../packages/cli/src/usage";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * P6 Task 10：info 扩展（观测后端）+ usage 契约。
 *  - usage 文本含 init / dev / build / preview / info / merge 行
 *  - info 追加后端段：`bin/oj -V` 现场版本 vs 安装标记（bin/.oj-version，vendor 下载时写入）、
 *    `GET /api/health` 证书状态、解析出的 port/base
 *  - 任一不可达仅告警不失败（报障输出要能拿全其它信息）
 */

const logs: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	logs.length = 0;
	logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		logs.push(args.join(" "));
	});
	vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
		logs.push(`[warn] ${args.join(" ")}`);
	});
});

afterEach(() => {
	logSpy.mockRestore();
});

/** oj 观测桩：版本与健康探测均可注入 */
function stubObservability(version: string | null, health: Record<string, unknown> | null) {
	return {
		ojVersion: () => version,
		ojHealth: () => Promise.resolve(health),
	};
}

describe("usage 契约", () => {
	it("包含全部六条子命令行", () => {
		const text = usageText();
		for (const cmd of ["init", "dev", "build", "preview", "info", "merge"]) {
			expect(text).toMatch(new RegExp(`ram ${cmd}`));
		}
	});
});

describe("ram info 后端段（桩注入）", () => {
	it("版本行 + 证书行 + port/base 齐全", async () => {
		const root = fs.mkdtempSync(path.join(path.dirname(PROJECT_ROOT), ".tmp-info-fx-"));
		try {
			fs.mkdirSync(path.join(root, "api"), { recursive: true });
			fs.writeFileSync(path.join(root, "api/config.yaml"), "server:\n  host: 127.0.0.1\n  port: 9778\n  base: /api\n");

			await printInfo(root, stubObservability("oj 0.1.0", {
				status: "OK",
				certificate_status: "valid",
				certificate_expiry: "2036-08-29T05:40:02+00:00",
			}));

			const out = logs.join("\n");
			expect(out).toMatch(/安装标记.*未知/);
			expect(out).toMatch(/现场.*oj 0\.1\.0/);
			expect(out).toMatch(/9778/);
			expect(out).toMatch(/\/api/);
			expect(out).toMatch(/valid/);
			expect(out).toMatch(/2036-08-29T05:40:02\+00:00/);
		}
		finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("bin/oj 不可探测 → 仅告警不失败", async () => {
		const root = fs.mkdtempSync(path.join(path.dirname(PROJECT_ROOT), ".tmp-info-fx-"));
		try {
			fs.mkdirSync(path.join(root, "bin"), { recursive: true });
			fs.writeFileSync(path.join(root, "bin/oj"), "not-executable");
			await expect(printInfo(root, stubObservability(null, null))).resolves.toBeUndefined();
			const out = logs.join("\n");
			expect(out).toMatch(/无法探测（缺失或不可执行）/);
			expect(out).toMatch(/无法探测（服务未运行/);
		}
		finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("服务未运行（health 为 null）→ 证书行提示无法探测，port/base 仍输出", async () => {
		const root = fs.mkdtempSync(path.join(path.dirname(PROJECT_ROOT), ".tmp-info-fx-"));
		try {
			fs.mkdirSync(path.join(root, "api"), { recursive: true });
			fs.writeFileSync(path.join(root, "api/config.yaml"), "server:\n  host: 127.0.0.1\n  port: 9778\n  base: /api\n");

			await printInfo(root, stubObservability("oj 0.1.0", null));

			const out = logs.join("\n");
			expect(out).toMatch(/9778/);
			expect(out).toMatch(/无法探测|未运行/);
		}
		finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("安装标记与现场版本不一致 → drift 告警（ram vendor --force 提示）", async () => {
		const root = fs.mkdtempSync(path.join(path.dirname(PROJECT_ROOT), ".tmp-info-fx-"));
		try {
			fs.mkdirSync(path.join(root, "bin"), { recursive: true });
			fs.writeFileSync(path.join(root, "bin/oj"), "#!/bin/sh\necho oj\n");
			fs.writeFileSync(path.join(root, "bin/.oj-version"), "v9.9.9\n");

			await printInfo(root, stubObservability("oj 0.1.0", null));

			const out = logs.join("\n");
			expect(out).toMatch(/安装标记.*v9\.9\.9/);
			expect(out).toMatch(/\[!\] 现场版本与安装标记/);
		}
		finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("f4：bin/oj 存在但 config.yaml 缺失 → 默认真实现不崩溃，证书行无法探测", async () => {
		const root = fs.mkdtempSync(path.join(path.dirname(PROJECT_ROOT), ".tmp-info-fx-"));
		try {
			fs.mkdirSync(path.join(root, "bin"), { recursive: true });
			fs.writeFileSync(path.join(root, "bin/oj"), "not-executable");

			// 不注入桩：走 realOjObservability，ojHealth 内部读 config 会 ENOENT——
			// 同步 throw 不得穿透 .catch 让 ram info 崩掉
			await expect(printInfo(root)).resolves.toBeUndefined();

			const out = logs.join("\n");
			expect(out).toMatch(/无法探测/);
		}
		finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
