// sidecar 状态存储（D12）：.solutions/state.yaml 读写——enabled/时间戳/GC 元数据
// 不进 oj 原生扁平锁（manifests.yaml 嵌套结构会拒启），全部落这里。
// YAML 采用受限子集（两层 map + 标量，键序固定、方案键排序输出），格式形如：
//
//   solutions:
//     demo:
//       version: "1.0.0"
//       enabled: true
//       installedAt: 1730000000000
//       archive: "{\"sha256\":\"…\",\"key_id\":\"…\",\"signature\":{…}}"   # P2-6 复验真源（JSON 字符串标量）
//       trust_state: trusted                                            # P2-6 发布方 key 状态缓存
//
// 只保证读回本模块自己写出的内容，不引入 yaml 依赖；任何不符格式的字节一律视为
// 损坏 → 空状态，损坏上下文并入读结果（corruptNote/corruptReason；禁 console——release
// isolate console 抛 BadResource，Finding A；不炸，write 会以 patch 为基自愈重写）。
// read() 返回工厂 hydrate 时的同步快照（逐条目克隆，调用方改动不影响 store）；
// write() 每次从盘上最新内容做读-改-写合并（多写者不丢彼此的方案键），
// patch 值为 null 表示删除该方案键（GC/卸载的删除出口）。
// fs 依赖同 atomic.ts（globalThis.fs 面）。

import { atomicWriteText, fsFace } from "./atomic";

export interface SolutionEntry {
	version: string
	enabled: boolean
	installedAt: number
	/**
	 * P2-6 复验真源：安装时落的包摘要 + 签名记录（D11③ 切换前复验 / 同版本重装摘要比对）。
	 * JSON 字符串标量落盘（两层 YAML 约束保持）；P1 时代条目无此字段 = 无验签真源。
	 */
	archive?: { sha256: string, key_id: string, signature: Record<string, unknown> }
	/** 发布方 key 状态缓存（P2-6：安装=trusted；启用时 key 已吊销=untrusted；P1 时代条目=absent） */
	trust_state?: "trusted" | "untrusted" | "absent"
}

export interface SolutionState {
	solutions: Record<string, SolutionEntry>
}

export interface StateStore {
	read: () => SolutionState
	write: (patch: Partial<SolutionState>) => Promise<void>
	/** 最近一次盘上读到的损坏 note（null = 未损坏；诊断观测出口，禁 console——Finding A；可选，测试 stub 免实现） */
	corruptNote?: () => string | null
}

const EMPTY: SolutionState = { solutions: {} };

/**
 * 快照克隆：oj isolate 无 structuredClone（P1-13 真机冒烟实测 500，契约附录 B-8）；
 * 状态形状是受限子集（string/bool/number 的两层 map），逐条目浅拷贝即达「调用方改动不影响 store」。
 */
function snapshot(state: SolutionState): SolutionState {
	const solutions: Record<string, SolutionEntry> = {};
	for (const [name, entry] of Object.entries(state.solutions)) {
		// archive 是嵌套对象：逐层克隆（调用方改动不得影响 store 缓存；P2-6 复验真源）
		solutions[name] = entry.archive === undefined
			? { ...entry }
			: { ...entry, archive: { ...entry.archive, signature: { ...entry.archive.signature } } };
	}
	return { solutions };
}

/**
 * 工厂为 async：构造时从盘上 hydrate 一次，之后 read() 走同步快照（平台 fs 面纯异步，同步 read 只能基于缓存）。
 * 需要观察外部更新的场景重建工厂即可（安装流程一次性构造，无长生命周期需求）。
 */
export async function createStateStore(path: string): Promise<StateStore> {
	let disk = await readDisk(path);
	let cache = disk.state;
	let note = disk.corruptReason;
	return {
		read: () => snapshot(cache),
		corruptNote: () => note,
		async write(patch: Partial<SolutionState>): Promise<void> {
			disk = await readDisk(path);
			note = disk.corruptReason;
			const solutions: Record<string, SolutionEntry> = { ...disk.state.solutions };
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
			note = null; // 写成功即自愈：损坏 note 清零（下次读以盘上真身为准）
			cache = next;
		},
	};
}

async function readDisk(path: string): Promise<{ state: SolutionState, corrupted: boolean, corruptReason: string | null }> {
	let text: string;
	try {
		text = new TextDecoder().decode(await fsFace().readFile(path));
	}
	catch {
		// 不存在/不可读一律按空状态（读缺失文件不炸）
		return { state: EMPTY, corrupted: false, corruptReason: null };
	}
	try {
		return { state: parseState(text), corrupted: false, corruptReason: null };
	}
	catch (e) {
		// 损坏上下文并入读结果（store.corruptNote 出口；禁 console——release isolate console 抛 BadResource，Finding A）
		return { state: EMPTY, corrupted: true, corruptReason: `${path} 不是本模块写出的合法状态文件，按空状态处理（${String(e)}）` };
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
		if (e.archive !== undefined) {
			lines.push(`    archive: ${JSON.stringify(JSON.stringify(e.archive))}`);
		}
		if (e.trust_state !== undefined) {
			lines.push(`    trust_state: ${e.trust_state}`);
		}
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
		const entry: SolutionEntry = { version, enabled: enabled === "true", installedAt: Number(installedAt) };
		let j = i + 4;
		// P2-6 可选行（顺序固定：archive 先、trust_state 后；缺即无——P1 时代条目只有四行）
		const archiveLiteral = /^ {4}archive: "((?:[^"\\]|\\.)*)"$/.exec(lines[j] ?? "")?.[1];
		if (archiveLiteral !== undefined) {
			try {
				const parsed = JSON.parse(JSON.parse(`"${archiveLiteral}"`)) as unknown;
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
					throw new Error("非对象");
				const a = parsed as Record<string, unknown>;
				if (typeof a.sha256 !== "string" || typeof a.key_id !== "string" || typeof a.signature !== "object" || a.signature === null)
					throw new Error("缺 sha256/key_id/signature");
				entry.archive = { sha256: a.sha256, key_id: a.key_id, signature: a.signature as Record<string, unknown> };
			}
			catch {
				throw new Error(`方案「${name}」archive 行不是合法复验真源 JSON`);
			}
			j += 1;
		}
		const trust = /^ {4}trust_state: (trusted|untrusted|absent)$/.exec(lines[j] ?? "")?.[1];
		if (trust !== undefined) {
			entry.trust_state = trust as "trusted" | "untrusted" | "absent";
			j += 1;
		}
		solutions[name] = entry;
		i = j;
	}
	return { solutions };
}
