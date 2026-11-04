import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	collectDynamicRequires,
	collectExportGaps,
	collectStaticClosure,
	collectUnresolvedSpecifiers,
	formatExportGap,
	parseEsmImports,
	readShellImportmap,
} from "../../packages/cli/src/esm-exports";
import {
	assetHash,
	hashedAssetFileName,
	isImmutableAssetFileName,
	SHARED_DEPS,
} from "../../packages/cli/src/shared-deps";
import { PROJECT_ROOT, shellAssetPath } from "../helpers/paths";

const SHELL_DIST = path.join(PROJECT_ROOT, "packages/cli/shell-dist");
const RUNTIME_DIST_JS = path.join(PROJECT_ROOT, "packages/runtime/dist/runtime.js");

function readImportmap(): Record<string, string> {
	const html = fs.readFileSync(path.join(SHELL_DIST, "index.html"), "utf-8");
	// P6.2 起标签带 nonce 属性
	const match = html.match(/<script type="importmap"[^>]*>(.*?)<\/script>/s);
	expect(match, "index.html 缺少 importmap").toBeTruthy();
	return JSON.parse(match![1]).imports;
}

/**
 * P4.3：shell 预构建 + importmap 由 cli 的 SHARED_DEPS 单一来源生成，
 * 产物覆盖共享表全量（B11：手写 15 项必然漏配），runtime.js 与包 dist 一致。
 */
describe("shell 产物与 importmap（P4.3 / B11）", () => {
	it("importmap 覆盖共享表全部带 asset 条目", () => {
		const importmap = readImportmap();
		for (const dep of SHARED_DEPS) {
			// bundle 依赖（软共享缺席→模块自带副本兜底）按设计不进 importmap
			if (dep.bundle)
				continue;
			expect(importmap[dep.specifier], `${dep.specifier} 无 importmap 映射`).toBeTruthy();
		}
	});

	it("每个映射的产物文件真实存在", () => {
		const importmap = readImportmap();
		for (const [specifier, url] of Object.entries(importmap)) {
			const file = path.join(SHELL_DIST, url.replace(/^\//, ""));
			expect(fs.existsSync(file), `${specifier} → ${url} 文件缺失`).toBe(true);
		}
	});

	it("runtime.js 与 runtime 包 dist 完全一致（sha256）", () => {
		const shellRuntime = fs.readFileSync(shellAssetPath("runtime"));
		const pkgRuntime = fs.readFileSync(RUNTIME_DIST_JS);
		const h = (buf: string) => createHash("sha256").update(buf).digest("hex");
		expect(h(shellRuntime.toString("utf8"))).toBe(h(pkgRuntime.toString("utf8")));
	});
});

/**
 * 图标深路径内联（回归：tabbar 关闭 × 丢失 / 首屏 51 个 0.5KB 小请求）。
 *
 * antd 6 内部用**默认导入**引用图标：
 *   `import CloseOutlined from "@ant-design/icons/es/icons/CloseOutlined"`
 * 这类深路径曾经每条都映射到独立 shim 资产（每个图标一个文件、一次请求），
 * 而 shim 必须把 default 修正为同名具名导出 —— 直接用父包 icons.js 兜底会让
 * default 退化成通用 `<Icon />` 壳（无 icon prop），渲染出空的
 * `<span class="anticon">`（关闭 ×、Typography 复制、Tabs 更多菜单一起消失）。
 *
 * 现在构建期（inlineIconSubpathDefaults）把深路径内联成
 * `export { CloseOutlined as default } from "@ant-design/icons"`，
 * 产物只剩一条具名导入。守卫这两点：深路径不再出现，且图标确实按名取自父包
 * （default 语义仍指向具体组件，父包实例仍单例）。
 */
describe("图标深路径内联（回归守卫）", () => {
	it("importmap 与产物里都不再有图标深路径", () => {
		const importmap = readImportmap();
		const iconEntries = Object.keys(importmap)
			.filter(spec => spec.startsWith("@ant-design/icons/es/icons/"));
		expect(iconEntries, "图标深路径应内联进消费方资产，不再单独占 importmap 条目与一次请求").toEqual([]);

		for (const asset of ["antd", "pro-components"]) {
			const source = fs.readFileSync(shellAssetPath(asset), "utf-8");
			expect(
				source.includes("@ant-design/icons/es/icons/"),
				`${asset} 仍残留图标深路径（内联未生效），会退化成每个图标一次请求`,
			).toBe(false);
		}
	});

	it("antd 从父包按名取图标（default 指向具体组件而非通用 Icon 壳）", () => {
		const source = fs.readFileSync(shellAssetPath("antd"), "utf-8");
		const consumed = parseEsmImports(source)
			.find(imp => imp.specifier === "@ant-design/icons");
		expect(consumed, "antd.js 应从 \"@ant-design/icons\" 导入图标").toBeTruthy();
		expect(
			consumed!.names,
			"关闭 × 用的 CloseOutlined 必须按名从父包取（通用 Icon 壳会渲染成空的 anticon）",
		).toContain("CloseOutlined");
	});
});

/**
 * 共享资产可加载性（R14 / A22 / A23）。
 *
 * 产物「看着正常」不等于能加载：文件在、体积对、构建退出码 0，全都不足以证明可用。
 * 实测踩到过两类静默失败，都会让整页白屏：
 *   - A22：`export *` 经 external 子路径退化，产物零具名导出
 *     → 浏览器抛 "does not provide an export named"（如 zustand/create）
 *   - A23：被打包的 CJS 依赖 require 了 external 共享包
 *     → 浏览器抛 "Dynamic require of ... is not supported"（7 个资产加载即崩）
 * 这里与 shell 构建脚本共用同一份判定实现，避免两套正则漂移。
 */
describe("共享资产可加载性（R14 / A22 / A23）", () => {
	it("每个被 import 的具名导出都能在目标资产上静态找到", () => {
		const gaps = collectExportGaps(SHELL_DIST);
		expect(
			gaps.map(formatExportGap),
			"存在浏览器会抛 \"does not provide an export named\" 的资产，"
			+ "常见根因是 export * 经 external 子路径退化（A22），请重新构建 shell",
		).toEqual([]);
	});

	it("不存在未被垫片覆盖的动态 require（A23）", () => {
		const hits = collectDynamicRequires(SHELL_DIST);
		expect(
			hits.map(h => `${h.file} → require("${h.specifier}")`),
			"存在浏览器会抛 \"Dynamic require of ... is not supported\" 的资产，"
			+ "构建期应注入 require 垫片，请重新构建 shell",
		).toEqual([]);
	});

	it("产物引用的裸说明符全部能被 importmap 解析", () => {
		const unresolved = collectUnresolvedSpecifiers(SHELL_DIST);
		expect(
			unresolved.map(g => `${g.file} → "${g.specifier}"`),
			"存在浏览器会抛 \"Failed to resolve module specifier\" 的裸说明符，"
			+ "深路径须在 SHARED_DEPS 中单独成条（importmap 无前缀通配）",
		).toEqual([]);
	});

	it("runtime.js 依赖的共享具名导出全部可解析", () => {
		const importmap = readShellImportmap(SHELL_DIST);
		// 框架产物是最大的消费方，且 A22 的第一例就是它 import 的 zustand/create
		const runtimeSource = fs.readFileSync(shellAssetPath("runtime"), "utf-8");
		// 产物已压缩（`from"react"` 无空白），故按词法解析出的说明符比对
		const consumed = new Set(parseEsmImports(runtimeSource).map(imp => imp.specifier));
		for (const spec of ["zustand", "react", "react-router", "antd", "react-i18next"]) {
			expect(importmap[spec], `${spec} 无 importmap 映射`).toBeTruthy();
			expect(consumed.has(spec), `runtime.js 应消费 ${spec}`).toBe(true);
		}
	});
});

/**
 * 内容寻址命名（缓存命中率的硬前提）。
 *
 * oj serve ≥ 0.1.116 按**文件名**判定 Cache-Control：stem 末段 ≥8 位且同时含数字
 * 与字母才发 `immutable, max-age=31536000`，否则 `no-cache`（每次开页多一个协商
 * RTT）。此前共享资产是 `/assets/antd.js` 这类无哈希名 → 全部落 no-cache。
 * 这里钉两件事：名字必须够格长缓存、名字必须真的由内容算出（不是随机/时间戳，
 * 否则内容没变也会让用户重下）。
 */
describe("共享资产内容寻址（immutable 缓存）", () => {
	it("assets 下全部 .js 都满足 immutable 判定（含宿主入口 chunk）", () => {
		const files = fs.readdirSync(path.join(SHELL_DIST, "assets")).filter(f => f.endsWith(".js"));
		expect(files.length).toBeGreaterThan(50);
		const bad = files.filter(f => !isImmutableAssetFileName(f));
		expect(
			bad,
			`以下资产名落不进 oj serve 的 immutable 档（末段须 ≥8 位且数字字母都有），会静默退化 no-cache：${bad.join(", ")}`,
		).toEqual([]);
	});

	it("importmap 每个值都指向带哈希段的资产，且哈希等于内容哈希", () => {
		const importmap = readImportmap();
		for (const [specifier, url] of Object.entries(importmap)) {
			const match = url.match(/^\/assets\/(.+)\.([0-9a-z]{10})\.js$/);
			expect(match, `${specifier} → ${url}：importmap 值必须是内容寻址名`).toBeTruthy();
			const [, base, hash] = match!;
			const content = fs.readFileSync(path.join(SHELL_DIST, url.replace(/^\//, "")));
			expect(
				hashedAssetFileName(base, content),
				`${specifier} 的文件名与内容对不上（改了产物却复用旧名 = 用户拿到过期缓存）`,
			).toBe(`${base}.${hash}.js`);
			expect(assetHash(content)).toBe(hash);
		}
	});
});

/**
 * 首屏预取闭包（2026-11-04）。
 *
 * 宿主入口的静态依赖图是 3 层深、约 57 个文件（浏览器 ESM 语义：先取完整静态图
 * 再执行）。HTTP/1.1 只有 6 条连接，逐层发现意味着后两层要白等 RTT——实测同一份
 * dist 只改这一个属性做 A/B：RTT 150ms / 10Mbps 布局可见 3146→3008ms（−4.4%），
 * RTT 60ms 静态资产末 1378→1316ms。省的是 RTT 不是字节。浏览器拿不到 h2c
 * （只认 TLS 上的 h2），所以这个展平对 1.1 是刚需。
 *
 * 守卫口径：产物里的 data-ojm-preload 必须**恰好**等于入口的静态闭包。
 * 少一条 = 该层退回瀑布；多一条 = 白拉一个用不上的资产。
 */
describe("首屏预取闭包（data-ojm-preload）", () => {
	const html = fs.readFileSync(path.join(SHELL_DIST, "index.html"), "utf-8");
	const entry = /data-ojm-entry="([^"]+)"/.exec(html)?.[1] ?? "";
	const urls = (/data-ojm-preload="([^"]*)"/.exec(html)?.[1] ?? "").split(",").filter(Boolean);

	it("每条都指向真实资产，且不含入口自身、不重复", () => {
		expect(urls.length, "index.html 缺少 data-ojm-preload（shell 构建未注入）").toBeGreaterThan(0);
		expect(urls).not.toContain(entry);
		expect(new Set(urls).size).toBe(urls.length);
		for (const url of urls)
			expect(fs.existsSync(path.join(SHELL_DIST, url.replace(/^\//, ""))), `${url} 不存在`).toBe(true);
	});

	it("恰好等于宿主入口的静态闭包（少 = 退回瀑布，多 = 白拉）", () => {
		const expected = collectStaticClosure(entry, readImportmap(), (url) => {
			const file = path.join(SHELL_DIST, url.replace(/^\//, ""));
			return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : undefined;
		}).filter(url => url !== entry);
		expect([...urls].sort()).toEqual(expected.sort());
	});
});
