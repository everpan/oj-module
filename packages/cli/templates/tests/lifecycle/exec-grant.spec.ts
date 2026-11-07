// exec 授权守卫（2026-11-07 市场线演练实锤）：
// oj 的 exec 按「请求模块上下文」逐模块授权（oj-bin bridge/exec.rs per_module）——
// 安装器在端点请求内同步跑（解压 tar / oj migrate 都要 exec），所以编排面落在
// 哪个 api 模块，哪个模块就必须持有与 _platform 完全一致的 allow 清单。
// Phase B 把市场编排面放在 src/oj-market/api（模块上下文 = oj-market），
// 而 config 只授权了 _platform → 真机上首装/收敛全部 NotCapable
// 「module 'oj-market' is not authorized for exec」（单测全注入 exec，绕过了授权层，
// 演练才暴露）。本守卫钉住：两模块授权同集合同命令、逐字一致。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../config.yaml");

interface ExecGrant { allow?: string[] }

function execGrants(): Record<string, ExecGrant> {
	const doc = parse(readFileSync(configPath, "utf8")) as { platform?: { exec?: Record<string, ExecGrant> } };
	return doc.platform?.exec ?? {};
}

describe("platform.exec 逐模块授权", () => {
	it("编排模块 oj-market 与 _platform 同集合同命令（逐字一致）", () => {
		const grants = execGrants();
		expect(Object.keys(grants).sort()).toEqual(["_platform", "oj-market"]);
		expect(grants["oj-market"]?.allow).toEqual(grants._platform?.allow);
		expect(grants._platform?.allow?.length).toBeGreaterThan(0);
	});

	it("编排模块 oj-market 具 platform 特权（安装器 reloadConfig/信任库写面；迁移自 _platform 编排端点）", () => {
		const doc = parse(readFileSync(configPath, "utf8")) as { platform?: { modules?: string[] } };
		expect(doc.platform?.modules).toContain("_platform");
		expect(doc.platform?.modules).toContain("oj-market");
	});
});
