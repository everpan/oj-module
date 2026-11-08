#!/usr/bin/env node
/**
 * 站点市场目录完整性核验（匿名只读，不装、不要凭据）。
 *
 * 目录「完整」= 三层同时成立：
 *   ① 目录行：GET /api/oj-market/catalog(.detail) —— 行在、latest/versions_count 自洽；
 *   ② 字节：GET <cdn>/<file> 重算 sha256，与行内 archive.sha256/size 相等（字节未被替换/截断）；
 *   ③ 签名：旁车 .sig 五字段与行内 archive.signature 逐字段一致，且 Ed25519 验
 *      canonical `<registry_id>:<name>@<version>:<sha256>` 通过（签名确实绑住这份字节）。
 *   未 yanked 的每个版本都必须三层全过；yanked 版本按「有意下线」跳过并标注。
 *
 * 用法：
 *   node scripts/check-catalog-integrity.mjs --site https://exp.wiz.top --name oj-market
 *   node scripts/check-catalog-integrity.mjs --site https://exp.wiz.top --all
 *   可选：--cdn <基址>   市场 CDN 基址（framework.market_cdn_url 改成绝对地址时用；缺省 <site>/cdn）
 *         --size <n>    catalog 分页大小（缺省 200，上限 200）
 *         --quiet       只打失败行与汇总
 *
 * 退出码：0 全部通过；1 有任一版本不合格（可用于 CI/cron 守护）。
 *
 * 注：目录行的写入侧对账（cdn/ 存量 → market_release 补录/纠偏）属 superadmin 面：
 *     `POST /api/oj-market/backfill`（幂等；报告 scanned/upserted/unchanged/skipped/sigMissing）。
 *     本脚本只做只读核验，不触发回填。
 */
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import process from "node:process";

const argv = process.argv.slice(2);
function arg(k, d = undefined) {
	const i = argv.indexOf(`--${k}`);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
}
const has = k => argv.includes(`--${k}`);

const site = (arg("site", process.env.OJM_SITE_URL) ?? "").replace(/\/+$/, "");
if (site === "") {
	console.error("缺少站点地址：--site <url> 或 OJM_SITE_URL");
	process.exit(2);
}
const cdn = (arg("cdn", `${site}/cdn`)).replace(/\/+$/, "");
const size = Math.min(200, Math.max(1, Number.parseInt(arg("size", "200"), 10) || 200));
const quiet = has("quiet");
const onlyNames = arg("name") === undefined ? [] : [arg("name")];
const all = has("all") || onlyNames.length === 0;

function ed25519Spki(hex) {
	return crypto.createPublicKey({
		key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex, "hex")]),
		format: "der",
		type: "spki",
	});
}

async function get(url) {
	const r = await fetch(url);
	if (!r.ok)
		throw new Error(`${url} -> HTTP ${r.status}`);
	return r;
}
function log(...a) {
	if (!quiet)
		console.log(...a);
}

const catalog = (await (await get(`${site}/api/oj-market/catalog?size=${size}`)).json()).data;
const allProducts = catalog.items.map(i => i.product);
const targets = all ? allProducts : onlyNames;
for (const n of targets) {
	if (!allProducts.includes(n))
		console.error(`catalog 中无产品「${n}」（现有：${allProducts.join(", ") || "空"}）`);
}
console.log(`站点 ${site}（registry_id ${catalog.registry_id}，api_version ${catalog.api_version}）—— 核验 ${targets.length} 个产品`);

let failed = 0;
let passed = 0;
let yanked = 0;

for (const name of targets) {
	if (!allProducts.includes(name))
		continue;
	const item = catalog.items.find(i => i.product === name);
	const detail = (await (await get(`${site}/api/oj-market/catalog/detail?name=${encodeURIComponent(name)}`)).json()).data;
	const versions = detail.versions ?? [];
	const live = versions.filter(v => v.yanked !== true);
	log(`\n[${name}] latest=${detail.latest} versions=${versions.length}（未 yank ${live.length}）`);

	if (item.versions_count !== live.length) {
		failed++;
		console.log(`  FAIL  catalog.versions_count=${item.versions_count} ≠ 未 yank 版本数 ${live.length}`);
	}

	for (const v of versions) {
		if (v.yanked === true) {
			yanked++;
			log(`  ${v.version}  skip(yanked)`);
			continue;
		}
		const file = v.archive?.file;
		try {
			const url = `${cdn}/${file}`;
			const bytes = Buffer.from(await (await get(url)).arrayBuffer());
			const sha = crypto.createHash("sha256").update(bytes).digest("hex");
			let sig = null;
			try {
				sig = JSON.parse(await (await get(`${url}.sig`)).text());
			}
			catch {}
			const rowSig = v.archive?.signature ?? null;
			const sizeOk = bytes.length === v.archive?.size;
			const shaOk = sha === v.archive?.sha256;
			const sigFields = ["alg", "key_id", "public_key", "value", "registry_id"];
			const sigRowOk = !!sig && !!rowSig && sigFields.every(k => sig[k] === rowSig[k]);
			let edOk = false;
			if (sig !== null) {
				const canonical = `${sig.registry_id}:${v.name}@${v.version}:${sha}`;
				try {
					edOk = crypto.verify(null, Buffer.from(canonical), ed25519Spki(sig.public_key), Buffer.from(sig.value, "base64"));
				}
				catch {}
			}
			const pass = sizeOk && shaOk && sigRowOk && edOk;
			if (pass)
				passed++;
			else
				failed++;
			const line = [
				`  ${v.version}`,
				`sha=${sha.slice(0, 12)}${shaOk ? "" : "(≠行)"}`,
				`size=${bytes.length}${sizeOk ? "" : "(≠行)"}`,
				`sig=${sig === null ? "缺失" : sig.key_id}${sigRowOk ? "/同行" : "/≠行"}`,
				`ed25519=${edOk ? "pass" : "FAIL"}`,
				pass ? "OK" : "FAIL",
			].join("  ");
			if (!pass || !quiet)
				console.log(line);
		}
		catch (e) {
			failed++;
			console.log(`  ${v.version}  FAIL  ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}

console.log(`\nRESULT: ${failed === 0 ? "PASS" : "FAIL"}（通过 ${passed} / 失败 ${failed} / yanked 跳过 ${yanked}）`);
process.exit(failed === 0 ? 0 : 1);
