/**
 * prepack：把随站第一方方案包（templates/dist/<name>-<version>.tgz + .sig）
 * 收进 cli 包的 shell-dist/bundles/——`ojm init --yes` 从此目录取包落位用户
 * 工程 cdn/（Phase B T3b，方案 §5）。
 *
 * 生产侧（T1 拍板）：签名是发布期手工动作（私钥永不出 ~/.ojm/keys），发布
 * 流水线顺序 = templates `pnpm build` → `ojm build --bundle oj-market` →
 * `ojm sign --registry-id <registry>`（产 .sig 旁车）→ `pnpm prepack`（本脚本）。
 *
 * templates/dist 不存在（源码仓未构建/未签名）→ 清空 shell-dist/bundles 并告警
 * 退出 0：源码直跑的 init --yes 走「warning 不失败」降级路径（init.ts 已有）。
 * 已发布包的 bundles 与本次不一致 → 覆盖同步（发布即唯一真源，不做增量）。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesDist = path.join(cliRoot, "templates", "dist");
const bundlesDir = path.join(cliRoot, "shell-dist", "bundles");

fs.rmSync(bundlesDir, { recursive: true, force: true });

if (!fs.existsSync(templatesDist)) {
	console.warn("[prepack] templates/dist 缺失——跳过随站方案包收编（发布包将不含 bundle，init --yes 走出厂未装降级）");
	process.exit(0);
}

const pairs = fs.readdirSync(templatesDist)
	.filter(f => f.endsWith(".tgz"))
	.flatMap(tgz => (fs.existsSync(path.join(templatesDist, `${tgz}.sig`)) ? [[tgz, `${tgz}.sig`]] : []))
	.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

if (pairs.length === 0) {
	console.warn("[prepack] templates/dist 无已签名 bundle（*.tgz+.sig）——发布包将不含随站方案包；init --yes 走出厂未装降级");
	process.exit(0);
}

fs.mkdirSync(bundlesDir, { recursive: true });
for (const [tgz, sig] of pairs) {
	fs.copyFileSync(path.join(templatesDist, tgz), path.join(bundlesDir, tgz));
	fs.copyFileSync(path.join(templatesDist, sig), path.join(bundlesDir, sig));
}
console.log(`[prepack] 随站方案包收编 ${pairs.length} 个：${pairs.map(([t]) => t).join(", ")}`);
