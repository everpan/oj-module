/**
 * 随站第一方方案包（shell-dist/bundles/oj-market-*.tgz）与模板源码的漂移守卫。
 *
 * 2026-11-07 回归复盘：79041343「市场卡片动作区不换行」只落到模板源码与单测，但随站
 * bundle 是修复前打包的旧字节（CLI 0.2.73 内置），站点 `ojm init --yes` 装到的仍是旧 UI
 * → 按钮换行复现。根因不是源码回归，而是「源码改了、发布产物没重建 + 没重签」：
 * 市场 UI 是纯 web 方案包随站分发，改 `src/oj-market/web/` 不会自动流进已签发的 tgz。
 *
 * 2026-11-07 最终形态「恢复宽度、去掉详情按钮、点击卡片正文出现详情」：网格恢复 340px，
 * 动作区去掉详情按钮只剩 5 枚（不换行、无 overflowX），详情入口改为点击卡片正文整块
 * （card-body-*）。79041343 的 overflowX:auto 横滚兜底已移除，先前临时加宽的 480px 已撤销。
 *
 * 两层守卫：
 *  ① 源码侧（源码仓恒生效）：钉死「340px + 正文可点 + nowrap + flexShrink 0」，并禁止回退到
 *     wrap / 480px / overflowX auto（会出现滚动条或宽度回退）。
 *  ② 产物侧（发布形态生效）：shell-dist/bundles 里若已有随站包，其 entry.js 必须带同一批
 *     特征且不含禁用项；缺一个即说明 bundle 落后于源码，须走发布流水线重建 + 重签（不能只改源码）。
 *     bundle 目录不存在 / 无 oj-market 包是源码仓直跑的合法态（init.ts:293 同哲学）→ 跳过，
 *     不误报；发布流水线把 bundle 收进 shell-dist 后本用例自动激活。
 *
 * 注意：本守卫只读，不重签。重签第一方包属发布流水线动作（私钥不入仓）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const templatesRoot = join(cliRoot, "templates");
const bundlesDir = join(cliRoot, "shell-dist", "bundles");

/** 布局修复的单一真源：源码该有 `source`，构建产物该匹配 `built`（79041343 + 2026-11-07 最终形态） */
const REQUIRED_MARKERS = [
	{ label: "动作区 testid", source: "card-actions-", built: /card-actions-/ },
	{ label: "卡片正文可点详情", source: "card-body-", built: /card-body-/ },
	{ label: "动作区不换行", source: "flexWrap: \"nowrap\"", built: /flexWrap:\s*"nowrap"/ },
	{ label: "按钮不收缩", source: "flexShrink: 0", built: /flexShrink:\s*0/ },
	{ label: "卡片宽度恢复 340", source: "minmax(340px, 1fr)", built: /minmax\(340px/ },
] as const;

/** 需求「不应出现滚动条」+ 防宽度回退：源码与产物都不该出现 */
const FORBIDDEN_MARKERS = [
	{ label: "横向滚动兜底（不应出现滚动条）", source: "overflowX: \"auto\"", built: /overflowX:\s*"auto"/ },
	{ label: "换行回退", source: "flexWrap: \"wrap\"", built: /flexWrap:\s*"wrap"/ },
	{ label: "临时加宽 480 已撤销", source: "minmax(480px, 1fr)", built: /minmax\(480px/ },
] as const;

/** 从 tgz 里取首个以 suffix 结尾的成员文本（node:zlib + 512B tar 头，零外部依赖、跨平台） */
function readTgzMember(tgzPath: string, suffix: string): string | null {
	const tar = gunzipSync(readFileSync(tgzPath));
	let off = 0;
	while (off + 512 <= tar.length) {
		const header = tar.subarray(off, off + 512);
		if (header.every(b => b === 0))
			break; // 两个零块 = tar 结束
		const name = header.subarray(0, 100).toString("utf-8").split("\0")[0] ?? "";
		const sizeRaw = header.subarray(124, 136).toString("utf-8").split("\0")[0]?.trim() ?? "";
		const size = Number.parseInt(sizeRaw, 8);
		if (!Number.isFinite(size) || size < 0)
			break;
		const dataStart = off + 512;
		if (name.endsWith(suffix))
			return tar.subarray(dataStart, dataStart + size).toString("utf-8");
		off = dataStart + Math.ceil(size / 512) * 512;
	}
	return null;
}

function bundledMarketTgzs(): string[] {
	if (!existsSync(bundlesDir))
		return [];
	return readdirSync(bundlesDir)
		.filter(f => /^oj-market-.*\.tgz$/.test(f))
		.map(f => join(bundlesDir, f));
}

const tgzs = bundledMarketTgzs();

describe("随站 oj-market 方案包与模板源码的不换行修复一致性", () => {
	it("模板源码钉死宽度 340 + 正文可点 + 不换行 + 无横滚（防止改回 wrap / 480px / overflowX auto）", () => {
		const card = readFileSync(join(templatesRoot, "src/oj-market/web/components/CardItem.tsx"), "utf-8");
		const grid = readFileSync(join(templatesRoot, "src/oj-market/web/components/CardGrid.tsx"), "utf-8");
		const source = `${card}\n${grid}`;
		for (const m of REQUIRED_MARKERS)
			expect(source, `模板源码缺「${m.label}」：${m.source}`).toContain(m.source);
		for (const m of FORBIDDEN_MARKERS)
			expect(source, `模板源码回退到「${m.label}」：${m.source}`).not.toContain(m.source);
	});

	it.skipIf(tgzs.length === 0)("发布形态：随站 bundle 的 entry.js 带同一批修复特征（源码改了必须重建 + 重签）", () => {
		for (const tgz of tgzs) {
			const built = readTgzMember(tgz, "/entry.js");
			expect(built, `${tgz} 内缺 entry.js（包结构变了？）`).not.toBeNull();
			for (const m of REQUIRED_MARKERS)
				expect(built, `${tgz} 落后于模板源码：缺「${m.label}」（${m.built}）。请走发布流水线重建 + 重签随站 bundle，勿只改源码`).toMatch(m.built);
			for (const m of FORBIDDEN_MARKERS)
				expect(built, `${tgz} 回退到「${m.label}」（${m.built}）。请重建 + 重签随站 bundle`).not.toMatch(m.built);
		}
	});
});
