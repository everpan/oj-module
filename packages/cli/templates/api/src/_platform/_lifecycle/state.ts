// sidecar 状态存储（D12）：.solutions/state.yaml 读写——enabled/时间戳/GC 元数据
// 不进 oj 原生扁平锁（manifests.yaml 嵌套结构会拒启），全部落这里。
// YAML 采用受限子集（两层 map + 标量，键序固定、方案键排序输出），格式形如：
//
//   solutions:
//     demo:
//       version: "1.0.0"
//       enabled: true
//       installedAt: 1730000000000
//
// 只保证读回本模块自己写出的内容，不引入 yaml 依赖；任何不符格式的字节一律视为
// 损坏 → 空状态 + console.warn（不炸，write 会以 patch 为基自愈重写）。
// read() 返回工厂 hydrate 时的同步快照（structuredClone，调用方改动不影响 store）；
// write() 每次从盘上最新内容做读-改-写合并（多写者不丢彼此的方案键），
// patch 值为 null 表示删除该方案键（GC/卸载的删除出口）。
// fs 依赖同 atomic.ts（globalThis.fs 面）。

import { atomicWriteText, fsFace } from "./atomic";

export interface SolutionEntry {
	version: string
	enabled: boolean
	installedAt: number
}

export interface SolutionState {
	solutions: Record<string, SolutionEntry>
}

export interface StateStore {
	read: () => SolutionState
	write: (patch: Partial<SolutionState>) => Promise<void>
}

const EMPTY: SolutionState = { solutions: {} };

/**
 * 工厂为 async：构造时从盘上 hydrate 一次，之后 read() 走同步快照（平台 fs 面纯异步，同步 read 只能基于缓存）。
 * 需要观察外部更新的场景重建工厂即可（安装流程一次性构造，无长生命周期需求）。
 */
export async function createStateStore(path: string): Promise<StateStore> {
	let cache = (await readDisk(path)).state;
	return {
		read: () => structuredClone(cache),
		async write(patch: Partial<SolutionState>): Promise<void> {
			const disk = (await readDisk(path)).state;
			const solutions: Record<string, SolutionEntry> = { ...disk.solutions };
			// patch 值运行时放宽允许 null（类型收窄见调用侧）：null = 删除该方案键
			const patchSolutions: Record<string, SolutionEntry | null> | undefined = patch.solutions;
			if (patchSolutions !== undefined) {
				for (const [name, entry] of Object.entries(patchSolutions)) {
					if (entry === null) {
						delete solutions[name];
					}
					else {
						solutions[name] = entry;
					}
				}
			}
			const next: SolutionState = { solutions };
			const text = serializeState(next); // 守卫先跑：任一条目非法即整次拒绝，盘与缓存都不动
			await atomicWriteText(path, text);
			cache = next;
		},
	};
}

async function readDisk(path: string): Promise<{ state: SolutionState, corrupted: boolean }> {
	let text: string;
	try {
		text = new TextDecoder().decode(await fsFace().readFile(path));
	}
	catch {
		// 不存在/不可读一律按空状态（读缺失文件不炸）
		return { state: EMPTY, corrupted: false };
	}
	try {
		return { state: parseState(text), corrupted: false };
	}
	catch (e) {
		console.warn(`state: ${path} 不是本模块写出的合法状态文件，按空状态处理（${String(e)}）`);
		return { state: EMPTY, corrupted: true };
	}
}

function serializeState(state: SolutionState): string {
	const names = Object.keys(state.solutions).sort();
	if (names.length === 0) {
		return "solutions: {}\n";
	}
	const lines = ["solutions:"];
	for (const name of names) {
		const e = state.solutions[name];
		assertEntry(name, e);
		lines.push(
			`  ${name}:`,
			`    version: ${JSON.stringify(e.version)}`,
			`    enabled: ${e.enabled}`,
			`    installedAt: ${e.installedAt}`,
		);
	}
	return `${lines.join("\n")}\n`;
}

/**
 * 落盘前的格式边界守卫：字段类型/字符集不合规直接拒绝，
 * 宁可让本次 write 失败也不把不可解析的字节写进状态文件（损坏 = 下次读全丢）。
 */
function assertEntry(name: string, e: SolutionEntry): void {
	if (!/^[\w.-]+$/.test(name)) {
		throw new Error(`state: 方案名「${name}」含格式外字符，拒绝落盘`);
	}
	if (typeof e.version !== "string" || hasQuoteOrControlChar(e.version)) {
		throw new Error(`state: 方案「${name}」version 必须是不含引号/反斜杠/控制字符的字符串`);
	}
	if (typeof e.enabled !== "boolean") {
		throw new TypeError(`state: 方案「${name}」enabled 必须是布尔值`);
	}
	if (typeof e.installedAt !== "number" || !Number.isInteger(e.installedAt)) {
		throw new TypeError(`state: 方案「${name}」installedAt 必须是整数毫秒时间戳`);
	}
}

/** 引号/反斜杠会破坏 version 的双引号定界，控制字符（< 0x20）在 YAML 双引号标量里非法——一律拒绝落盘。 */
function hasQuoteOrControlChar(s: string): boolean {
	return /["\\]/.test(s) || [...s].some(ch => ch.charCodeAt(0) < 32);
}

/** 严格解析：逐行匹配固定形状，任何偏差都算损坏（只读回自己写的内容，不做通用 YAML）。 */
function parseState(text: string): SolutionState {
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") {
		lines.pop();
	}
	if (lines.length === 0) {
		throw new Error("空文件");
	}
	if (lines[0] === "solutions: {}") {
		if (lines.length !== 1) {
			throw new Error("「solutions: {}」之后存在多余内容");
		}
		return EMPTY;
	}
	if (lines[0] !== "solutions:") {
		throw new Error(`首行应为「solutions:」，实为「${lines[0]}」`);
	}
	const solutions: Record<string, SolutionEntry> = {};
	let i = 1;
	while (i < lines.length) {
		const name = /^ {2}([\w.-]+):$/.exec(lines[i])?.[1];
		if (name === undefined) {
			throw new Error(`第 ${i + 1} 行应为方案名行，实为「${lines[i]}」`);
		}
		const version = /^ {4}version: "(.*)"$/.exec(lines[i + 1] ?? "")?.[1];
		const enabled = /^ {4}enabled: (true|false)$/.exec(lines[i + 2] ?? "")?.[1];
		const installedAt = /^ {4}installedAt: (-?\d+)$/.exec(lines[i + 3] ?? "")?.[1];
		if (version === undefined || enabled === undefined || installedAt === undefined) {
			throw new Error(`方案「${name}」条目格式不完整或字段损坏`);
		}
		solutions[name] = { version, enabled: enabled === "true", installedAt: Number(installedAt) };
		i += 4;
	}
	return { solutions };
}
