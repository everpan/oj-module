// materializeInstallerVersions spec：dev 形态补 C2-09 真源（支柱一，2026-11-07 实锤：
// /tmp/ojm-vv/drill dev 形态无 dist/api/versions.json → 随站 bundle 收敛被
// preflight C2-09 fail-closed 永久拒装，页面指引 ojm init --yes 是死路）。
//
// 行为钉：
//   - shell-dist 的 versions.json 拷入 <apiDist>/versions.json（安装器 B-11 读取面），
//     与 release 双落点同源（backend.ts 同款拷贝收进本函数，两处共用）；
//   - 目标目录自动创建；已有文件覆盖（派生物非用户数据，cli 升级后 dev 重启即刷新）；
//   - 源缺失 → 返回 false 不抛（源码仓直跑 shell-dist 未构建的合法态，告警归调用方）。

import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { materializeInstallerVersions } from "../build";

const roots: string[] = [];
function tempRoot(): string {
	const root = fs.mkdtempSync(join(tmpdir(), "ojm-instver-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

describe("materializeInstallerVersions", () => {
	it("把 shell-dist versions.json 拷入 apiDist（含 @oj-module/runtime 键）", () => {
		const root = tempRoot();
		const shellDist = join(root, "shell-dist");
		const apiDist = join(root, "dist", "api");
		fs.mkdirSync(shellDist, { recursive: true });
		fs.writeFileSync(join(shellDist, "versions.json"), JSON.stringify({ "@oj-module/runtime": "0.2.71", "react": "19.1.0" }));

		const ok = materializeInstallerVersions(apiDist, shellDist);

		expect(ok).toBe(true);
		const written = JSON.parse(fs.readFileSync(join(apiDist, "versions.json"), "utf-8")) as Record<string, string>;
		expect(written["@oj-module/runtime"]).toBe("0.2.71");
	});

	it("覆盖既有文件：cli 升级后 dev 重启刷新宿主 runtime 真源", () => {
		const root = tempRoot();
		const shellDist = join(root, "shell-dist");
		const apiDist = join(root, "dist", "api");
		fs.mkdirSync(shellDist, { recursive: true });
		fs.mkdirSync(apiDist, { recursive: true });
		fs.writeFileSync(join(shellDist, "versions.json"), JSON.stringify({ "@oj-module/runtime": "0.2.72" }));
		fs.writeFileSync(join(apiDist, "versions.json"), JSON.stringify({ "@oj-module/runtime": "0.2.71" }));

		materializeInstallerVersions(apiDist, shellDist);

		const written = JSON.parse(fs.readFileSync(join(apiDist, "versions.json"), "utf-8")) as Record<string, string>;
		expect(written["@oj-module/runtime"]).toBe("0.2.72");
	});

	it("源缺失返回 false 不抛（调用方告警，不阻断 dev 启动）", () => {
		const root = tempRoot();
		const ok = materializeInstallerVersions(join(root, "dist", "api"), join(root, "nope"));
		expect(ok).toBe(false);
		expect(fs.existsSync(join(root, "dist", "api"))).toBe(false);
	});
});
