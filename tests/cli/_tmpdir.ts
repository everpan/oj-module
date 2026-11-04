import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

/**
 * 跨平台临时目录。
 *
 * `mkdtempSync` 要求父目录已存在。Windows 上 vitest 会先建好
 * `node_modules/.cache`，macOS 上该目录不一定存在，直接 mkdtemp 会 ENOENT。
 * 这里显式 ensure 父目录存在后再建。
 */
export function mkTmp(base: string, prefix: string): string {
	const cache = join(base, "node_modules/.cache");
	mkdirSync(cache, { recursive: true });
	return mkdtempSync(join(cache, prefix));
}
