// 第一方 bootstrap key（P2-12，G3 双轨第一轨）：模板内置 oj-market 首包发布方公钥——
// market 首装免 TOFU（信任库为空时自动播种，直接过验签）。发布流程（devkit「签名与信任」章节，
// P2-14 引用）：发布人 `ojm keygen` 生成 Ed25519 对（私钥永不出 ~/.ojm/keys/<id>）→ `ojm sign`
// 签 oj-market 首发包 → 公钥（64 hex）+ key_id 回填本文件随模板发布。**模板内只有公钥**——
// 私钥入仓即信任根基烧毁（tests/lifecycle/bootstrap.spec 钉全仓 grep 私钥 pattern 零命中）。
// 播种纪律：只在信任库文件尚不存在时播种一次——不与运维吊销对抗（remove 后不复活，G5 语义）。

import { fsFace } from "../_lifecycle/atomic";
import { createTrustStore } from "../_lifecycle/trust";

export interface BootstrapKey {
	key_id: string
	/** 32B raw Ed25519 公钥 hex（C2-35 口径） */
	public_key: string
}

/**
 * 第一方发布方 key（oj-market 首包）。发布时回填——回填前为 null（播种即 no-op，
 * 首装走 TOFU 双轨第二轨：needs_trust → ojm trust confirm）。
 */
export const BOOTSTRAP_KEY: BootstrapKey | null = null;

/**
 * 引导播种（installBody 接线，runInstall 之前）：信任库文件尚不存在且 bootstrap key 在场 →
 * 播种并审计（operator="bootstrap" 标记机器播种）。key 为 null（未回填）或库已初始化 → no-op。
 */
export async function seedBootstrapKey(trustPath: string, key: BootstrapKey | null): Promise<void> {
	if (key === null) {
		return;
	}
	try {
		await fsFace().readFile(trustPath);
		return; // 库文件已存在（含空库）= 已初始化过 → 不播种（防吊销复活）
	}
	catch {
		// 不存在 → 首次引导
	}
	await createTrustStore(trustPath).add(key.key_id, key.public_key, { operator: "bootstrap" });
}
