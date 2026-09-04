/**
 * `ram vendor` —— oj vendor 按平台联网下载（设计 V1–V9）。
 *
 * 从 everpan/only-js 最新 release 取本平台资产，sha256 校验后装进工程
 * bin/。init 的内置 tar.gz 是离线兜底，本命令是联网更新通道，两者独立。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export interface ReleaseAsset {
	name: string
	browser_download_url: string
}

export interface Release {
	tag_name: string
	assets: ReleaseAsset[]
}

const TRIPLETS: Record<string, string> = {
	"darwin:arm64": "aarch64-apple-darwin",
	"darwin:x64": "x86_64-apple-darwin",
	"linux:x64": "x86_64-unknown-linux-gnu",
	"linux:arm64": "aarch64-unknown-linux-gnu",
	"win32:x64": "x86_64-pc-windows-msvc",
};

export function resolveTriplet(platform: string, arch: string): string {
	const triplet = TRIPLETS[`${platform}:${arch}`];
	if (!triplet) {
		throw new Error(
			`[ram] 暂不支持的平台组合：${platform}/${arch}。\n`
			+ `已支持：${Object.keys(TRIPLETS).map(k => k.replace(":", "/")).join("、")}`,
		);
	}
	return triplet;
}

/** Windows 资产为 zip（Rust 社区惯例，实测 v0.1.0），其余 tar.gz */
export function assetExt(platform: string): "tar.gz" | "zip" {
	return platform === "win32" ? "zip" : "tar.gz";
}

export function pickAsset(assets: ReleaseAsset[], tag: string, platform: string, arch: string): ReleaseAsset {
	const want = `oj-${tag}-${resolveTriplet(platform, arch)}.${assetExt(platform)}`;
	const hit = assets.find(a => a.name === want);
	if (!hit) {
		const names = assets.map(a => a.name).filter(n => !n.endsWith(".sha256"));
		throw new Error(
			`[ram] 最新 release（${tag}）没有本平台资产 ${want}。\n可用资产：\n  ${names.join("\n  ")}`,
		);
	}
	return hit;
}

function ojBinName(platform: string): string {
	return platform === "win32" ? "oj.exe" : "oj";
}

/** 本地版本只认 .oj-version 标记；bin/oj 缺失或标记缺失都视为未安装（V4） */
export function readLocalVersion(binDir: string, platform: NodeJS.Platform = process.platform): string | null {
	if (!fs.existsSync(path.join(binDir, ojBinName(platform))))
		return null;
	const marker = path.join(binDir, ".oj-version");
	if (!fs.existsSync(marker))
		return null;
	return fs.readFileSync(marker, "utf-8").trim() || null;
}
