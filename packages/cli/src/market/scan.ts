/**
 * tgz 读端（T4）：gunzip + 手写 ustar 解析，只为了从包里取出内嵌 `manifest.yaml`。
 *
 * 为什么手写而不用第三方 tar 库：写端 `deterministic-tar.ts` 就是手写 ustar（注释给了理由——
 * 跨平台 tar 方言会毁掉确定性），读端与它对称才可预期；且这里只需要「按路径取一个成员」，
 * 引一个通用 tar 库属于杀鸡用牛刀。相比「另存一份 manifest 到包外」的做法，
 * 包内 manifest 是单一真相——不存在旁路文件与包内容漂移的可能。
 */

import { Buffer } from "node:buffer";
import { gunzipSync } from "node:zlib";
import { parse as yamlParse } from "yaml";

const BLOCK = 512;

export interface ScannedEntry {
	name: string
	size: number
	content: Buffer
}

/** 把 .tgz 解开为可读成员列表（无视 EOF 末尾的零块与补齐 bytes） */
export function readTgz(bytes: Uint8Array): ScannedEntry[] {
	let raw: Buffer;
	try {
		raw = gunzipSync(Buffer.from(bytes));
	}
	catch (error) {
		throw new Error(`不是合法的 gzip 包：${(error as Error).message}`);
	}
	const out: ScannedEntry[] = [];
	let offset = 0;
	while (offset + BLOCK <= raw.length) {
		const header = raw.subarray(offset, offset + BLOCK);
		if (isZeroBlock(header))
			break;
		const size = readOctal(header, 124, 12);
		const typeflag = String.fromCharCode(header[156]!);
		const name = entryName(header);
		offset += BLOCK;
		if (typeflag === "0" || typeflag === "\0") {
			const content = raw.subarray(offset, offset + size);
			out.push({ name, size, content });
		}
		else if (typeflag !== "5") {
			// 其余类型（链接/设备等）不该出现在本地 CDN 包里；跳过即可，不因此拒绝整个包
		}
		const pad = (BLOCK - (size % BLOCK)) % BLOCK;
		offset += size + pad;
	}
	return out;
}

/**
 * 取包内 manifest.yaml；找不到返回 null（调用方决定跳过还是报错）。
 *
 * 两种布局都认：直接以方案目录为根打的包（`manifest.yaml`）与外层再套一层
 * `<name>-<version>/` 的包——写端 `createDeterministicTgz` 的成员路径是相对传入目录的，
 * 传方案目录即前者；手 tar 打包常是后者。只认顶层那一份，不认 api 子目录下的其他 manifest。
 */
export function readEmbeddedManifest(bytes: Uint8Array): Record<string, unknown> | null {
	const hit = readTgz(bytes).find(e => /^(?:[^/]+\/)?manifest\.yaml$/.test(e.name));
	if (hit === undefined)
		return null;
	// manifest 是完整 YAML（含 api/web/routes 嵌套结构），必须走真解析器：
	// 它是索引的唯一真相源，解析不准就等于给下游喂假索引。
	return (yamlParse(hit.content.toString("utf-8")) ?? null) as Record<string, unknown> | null;
}

function isZeroBlock(block: Buffer): boolean {
	for (const byte of block) {
		if (byte !== 0)
			return false;
	}
	return true;
}

/** name(100) + prefix(155) 复原完整路径（与写端 splitUstarName 对称） */
function entryName(header: Buffer): string {
	const name = cstring(header, 0, 100);
	const prefix = cstring(header, 345, 155);
	if (prefix === "")
		return name;
	return `${prefix}/${name}`;
}

function cstring(buf: Buffer, offset: number, length: number): string {
	const slice = buf.subarray(offset, offset + length);
	const end = slice.indexOf(0);
	return slice.subarray(0, end === -1 ? length : end).toString("utf-8");
}

function readOctal(buf: Buffer, offset: number, length: number): number {
	const text = cstring(buf, offset, length).trim();
	if (text === "")
		return 0;
	const value = Number.parseInt(text, 8);
	return Number.isNaN(value) ? 0 : value;
}
