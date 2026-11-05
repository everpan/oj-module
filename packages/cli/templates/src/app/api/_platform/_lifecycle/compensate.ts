// 安装补偿清单（P0 §3.5）：锁后失败（registering/deploying_web/reloading/smoke）时，把站点恢复到
// 「装前代」状态——旧代继续服务，任务标 partial + 可重试。本模块是回滚的唯一入口（SRP：只负责
// 逆序回滚已落盘资产，不含装前校验/审计/终态文案），各资产回滚原语各自单一函数（OCP：新增资产
// 类型只需加一个原语 + 在此注册一步）。所有原语幂等（缺则 no-op），故补偿可安全被重试端点反复调用。
// 与 cancelCleanup 的区别（intentionally 不同）：取消 = 回到装前且删版本目录；补偿 = 回到装前代
// 但**保留版本目录**供重试。两者共用 revertLock（lock.ts）不重复锁回退逻辑（DRY）。

import type { ReloadFace } from "./steps/reload";
import { atomicWriteText, fsFace, isMissingPath } from "./atomic";
import { revertLock } from "./lock";
import { removeModulesJsonEntry } from "./steps/deploy-web";
import { removeAnonymousPaths } from "./text-edit";
import { revertRegistrations } from "./uninstall";

/** 本仓 preview 派生文件名（与 cli preview-config.ts / installer.ts 逐字一致） */
const PREVIEW_CONFIG_NAME = ".ojm-preview.yaml";

/** 与 config 同目录的 preview 派生路径（无目录分隔符 = 同目录裸名）；本地化避免与 installer.ts 循环依赖 */
function previewSiblingOf(configPath: string): string {
	const cut = Math.max(configPath.lastIndexOf("/"), configPath.lastIndexOf("\\"));
	return cut < 0 ? PREVIEW_CONFIG_NAME : `${configPath.slice(0, cut + 1)}${PREVIEW_CONFIG_NAME}`;
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface CompensateInput {
	/** 方案名 */
	name: string
	/** 本次安装版本 */
	version: string
	/** config.yaml 路径（缺省 "config.yaml"） */
	configPath: string
	/** reloading 段真正新增的匿名路径（installer 已写入 req.deferredAnonymous）；空 = 未接线，config 步 no-op */
	deferredAnonymous: string[]
	/** 站点 sharedRoot（锁/版本目录所在） */
	sharedRoot: string
	/** 站点 modules.json 路径 */
	modulesJsonPath: string
	/** runInstall 起始捕获的装前锁快照 */
	lockBefore: Record<string, string>
	/** 装前锁文件是否存在（首装 = false → 回退即删锁） */
	lockExisted: boolean
	/** 注入式 reload 面（与 reloadStage 同源） */
	reload: ReloadFace
}

export interface CompensateStep {
	step: string
	ok: boolean
	message: string
}

export interface CompensateResult {
	/** 各步结果（逆序：config → lock → modules.json → db → reload） */
	steps: CompensateStep[]
	/** 是否全部成功（任一步失败即 false，但其余步仍尽力执行） */
	allOk: boolean
}

/**
 * 执行补偿回滚。每步独立 try/catch：单步失败记录进 steps 并继续其余步，最终 allOk 反映整体；
 * 调用方据 allOk 决定 task 文案（失败步需在 message 中点名，便于运维定位）。
 */
export async function compensate(input: CompensateInput): Promise<CompensateResult> {
	const steps: CompensateStep[] = [];
	const run = async (step: string, fn: () => Promise<void>): Promise<void> => {
		try {
			await fn();
			steps.push({ step, ok: true, message: `${step}：已回滚到装前代` });
		}
		catch (e) {
			steps.push({ step, ok: false, message: `${step}回滚失败：${String(e)}` });
		}
	};

	const f = fsFace();

	// 1. config 匿名移除（源 config + preview 派生，派生缺失即跳过）
	await run("config.anonymous", async () => {
		if (input.deferredAnonymous.length === 0) {
			return;
		}
		for (const p of [input.configPath, previewSiblingOf(input.configPath)]) {
			let content: string;
			try {
				content = new TextDecoder().decode(await f.readFile(p));
			}
			catch (e) {
				if (isMissingPath(e)) {
					continue;
				}
				throw e;
			}
			const { content: next, removed } = removeAnonymousPaths(content, input.deferredAnonymous);
			if (removed.length > 0) {
				await atomicWriteText(p, next);
			}
		}
	});

	// 2. lock 回写装前（首装则删锁；空锁拒启）
	await run("lock", async () => {
		await revertLock(input.sharedRoot, input.lockBefore, input.lockExisted);
	});

	// 3. modules.json 条目移除 + 断言（防并发写者插回）
	await run("modules.json", async () => {
		const { removed } = await removeModulesJsonEntry(input.name, { modulesJsonPath: input.modulesJsonPath });
		if (!removed) {
			return;
		}
		const list = JSON.parse(new TextDecoder().decode(await f.readFile(input.modulesJsonPath))) as unknown;
		if (Array.isArray(list) && list.some(e => isObj(e) && e.name === input.name)) {
			throw new Error("回滚后 modules.json 仍存在该模块条目（疑似并发写者插回）");
		}
	});

	// 4. DB 注册回退（复用卸载事务：删 route + 级联清角色/权限）
	await run("db.registrations", async () => {
		await revertRegistrations(input.name);
	});

	// 5. reload 让旧代生效（best-effort 重同步活动代；抛错即记失败，目标=活动代回到装前态）
	// 注：US-1 落地前上游仅按 config sha 判定——回退 config 会产出 applied（移除匿名），非 unchanged；
	// US-1 落地后预期 unchanged===true。两种皆视为成功（只要未抛错）。
	await run("reload", async () => {
		const r = await input.reload.reloadConfig();
		if (typeof r !== "object" || r === null || typeof r.unchanged !== "boolean") {
			throw new Error("reloadConfig 返回形状违约（expected {unchanged:boolean,...}）");
		}
	});

	return { steps, allOk: steps.every(s => s.ok) };
}
