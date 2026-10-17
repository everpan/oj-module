// 确定性 tgz 打包（P1-11，契约 C2-32）：固定 mtime=0、成员按路径字典序、权限 0644/0755、
// uid/gid=0 且无 owner 名——同输入两次打包 sha256 相等（可复现构建，发布留痕与校验的基础）。
// 打包自检（C2-30 构建列）：symlink/硬链接/特殊文件成员一律拒绝（tar 忠实还原链接，
// 安装侧 list→validate→extract 三步守卫的前提是包内没有守卫绕过面）。
// 手写 ustar 而不用系统 tar：跨平台 tar 的 mtime/权限/排序旗标方言不一，确定性无法逐字保证；
// ustar 是 POSIX 最小形态，系统 tar -tvzf/-xzf（安装侧 extract 段的唯一消费面）原生可读。
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const BLOCK = 512;
const RECORD = 20 * BLOCK; // 常规记录长度：GNU tar 缺省 -b20，补齐以兼容最保守的读端

interface Entry {
	relPath: string
	absPath: string
	type: "file" | "dir"
	size: number
}

/**
 * 把 `dir` 的内容打包为确定性 tgz 写到 `out`（父目录自动创建），返回 tgz 的 sha256（hex）。
 * 归档成员 = dir 下的相对路径（含唯一的顶层目录时即单根布局）。
 */
export async function createDeterministicTgz(dir: string, out: string): Promise<string> {
	if (!fs.statSync(dir).isDirectory()) {
		throw new Error(`[ojm] 确定性打包失败：${dir} 不是目录`);
	}
	const entries = walk(dir);
	const body: Buffer[] = [];
	for (const e of entries) {
		const isDir = e.type === "dir";
		const header = ustarHeader(e);
		body.push(header);
		if (!isDir) {
			const content = fs.readFileSync(e.absPath);
			body.push(content);
			const pad = (BLOCK - (content.length % BLOCK)) % BLOCK;
			if (pad > 0)
				body.push(Buffer.alloc(pad));
		}
	}
	body.push(Buffer.alloc(RECORD)); // 双零块 EOF（1024B）+ 补齐到整记录
	// Node zlib gzip 缺省不写 MTIME/FNAME（头内时间戳恒 0、无原始文件名）——确定性由测试钉住
	const tgz = gzipSync(Buffer.concat(body));
	const sha256 = crypto.createHash("sha256").update(tgz).digest("hex");
	fs.mkdirSync(path.dirname(out), { recursive: true });
	fs.writeFileSync(out, tgz);
	return sha256;
}

/** 深度收集全部成员并按 relPath 字典序排序（目录成员在子成员之前：`p` 是 `p/child` 的前缀） */
function walk(dir: string): Entry[] {
	const out: Entry[] = [];
	const visit = (absPath: string, relPath: string) => {
		const stat = fs.lstatSync(absPath);
		if (stat.isSymbolicLink()) {
			throw new Error(`[ojm] 打包自检失败（C2-30）：成员「${relPath}」是 symlink，禁入 tgz（tar 忠实还原链接，链接是安装守卫绕过面）——请改为实体文件`);
		}
		if (stat.isDirectory()) {
			out.push({ relPath, absPath, type: "dir", size: 0 });
			for (const e of fs.readdirSync(absPath, { withFileTypes: true }))
				visit(path.join(absPath, e.name), `${relPath}/${e.name}`);
			return;
		}
		if (stat.isFile()) {
			out.push({ relPath, absPath, type: "file", size: stat.size });
			return;
		}
		throw new Error(`[ojm] 打包自检失败（C2-30）：成员「${relPath}」既非文件亦非目录（lstat=${stat.mode.toString(8)}），禁入 tgz`);
	};
	for (const e of fs.readdirSync(dir, { withFileTypes: true }))
		visit(path.join(dir, e.name), e.name);
	return out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}

/** 512B ustar 头（POSIX 最小形态）：数字字段 NUL 结尾；uname/gname 空（无 owner 名）；mtime=0 */
function ustarHeader(e: Entry): Buffer {
	const fullName = e.type === "dir" ? `${e.relPath}/` : e.relPath;
	const split = splitUstarName(fullName);
	const h = Buffer.alloc(BLOCK);
	h.write(split.name, 0, 100, "utf8");
	if (split.prefix)
		h.write(split.prefix, 345, 155, "utf8");
	writeOctal(h, 100, 8, e.type === "dir" ? 0o755 : 0o644); // 权限固定：umask/源文件权限不泄漏
	writeOctal(h, 108, 8, 0); // uid=0
	writeOctal(h, 116, 8, 0); // gid=0
	writeOctal(h, 124, 12, e.size);
	writeOctal(h, 136, 12, 0); // mtime=0（确定性核心）
	h.write("ustar\0", 257, 6, "binary");
	h.write("00", 263, 2, "binary");
	// uname/gname（265/297 各 32B）保持全零 = 无 owner 名；devmajor/devminor 全零（非常规设备）
	h.write(e.type === "dir" ? "5" : "0", 156, 1, "binary"); // typeflag：目录/普通文件
	h.write(" ".repeat(8), 148, 8, "binary"); // POSIX：chksum 参与求和时本字段按 8 个空格计
	const sum = h.reduce((acc, byte) => acc + byte, 0);
	h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "binary"); // chksum：6 位八进制 + NUL + 空格
	return h;
}

/** 八进制数字字段：值左补零到 size-1，NUL 结尾 */
function writeOctal(buf: Buffer, offset: number, size: number, value: number): void {
	buf.write(`${value.toString(8).padStart(size - 1, "0")}\0`, offset, size, "binary");
}

/** ustar name(100)/prefix(155) 拆分；容量外拒绝并给可读错误（不用 pax 扩展头——其自带元数据是确定性反面） */
function splitUstarName(fullName: string): { name: string, prefix: string } {
	if (fullName.length <= 100)
		return { name: fullName, prefix: "" };
	let cut = -1;
	for (let i = fullName.indexOf("/"); i !== -1; i = fullName.indexOf("/", i + 1)) {
		if (i <= 155 && fullName.length - i - 1 <= 100)
			cut = i; // 取最后一个合法切点（确定性：fullName 相同则结果相同）
	}
	if (cut === -1) {
		throw new Error(`[ojm] 打包自检失败：成员路径长度超出 ustar 容量（name ≤100 / prefix ≤155），且路径过长无法拆分：「${fullName}」（${fullName.length} 字符）——请缩短目录/文件名`);
	}
	return { name: fullName.slice(cut + 1), prefix: fullName.slice(0, cut) };
}
