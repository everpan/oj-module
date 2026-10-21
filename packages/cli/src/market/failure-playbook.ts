/**
 * 失败路径人话文案表（T12 收尾，对标 `keygen.ts` 双段式：成因一句 + 下一步一句）。
 *
 * 逐失败码/阶段一条，随 walkthrough 报告落盘（`logs/walkthrough-<ts>.md` 的文案表段落）。
 * traceability：`__tests__/failure-playbook.test.ts` 守着 REQUIRED_CODES——每个 neg 场景
 * 预期命中的失败码都必须有条目，补新 neg op 时同步加行。
 */

export interface FailurePlaybookEntry {
	/** 失败码（六码 reason 或阶段级签名） */
	code: string
	/** 预期失败阶段（"安装前" 表示 POST 即被拒、任务未创建） */
	stage: string
	/** 成因一句（发生了什么） */
	cause: string
	/** 下一步一句（怎么办） */
	next: string
}

export const FAILURE_PLAYBOOK: FailurePlaybookEntry[] = [
	{
		code: "sig_missing",
		stage: "verifying",
		cause: "分发包未签名：发布方未做 detached 签名，或 CDN 目录里 .sig 被裁剪",
		next: "请发布方重发 `ojm market publish --check` 复核签名后重建索引",
	},
	{
		code: "tampered",
		stage: "verifying",
		cause: "包体或签名与索引不符：分发包被篡改，或同版本号被换包重发",
		next: "从可信源重新获取分发包；发布方应升版本号重发（同版本号只允许一份字节）",
	},
	{
		code: "unknown_key",
		stage: "verifying",
		cause: "发布方 key 不在宿主信任库，安装停在 needs_trust 待确认",
		next: "核对指纹后 `ojm trust confirm --task <task_id>` 入库，再重装即可",
	},
	{
		code: "rollback_guard",
		stage: "migrating",
		cause: "包内迁移最大 seq 低于账本 head：禁降版部署（OJ-9 红线），库保持原状",
		next: "正道是升级到新版本；确需回退请联系运维走对账自愈，勿强行降版",
	},
	{
		code: "index_sig",
		stage: "安装前（索引解析）",
		cause: "市场索引签名校验失败：bundles/manifests.yaml 被篡改或签名与字节不符",
		next: "重建索引并签名 `ojm market build-index`；同时核对 CDN 目录写入来源",
	},
	{
		code: "zip_slip",
		stage: "安装前（上传校验）",
		cause: "分发包含越界成员（../ 或绝对路径），R1 zip-slip 防护拒在解包前",
		next: "勿安装来路不明的包；发布方检查打包脚本，成员名必须是包内相对路径",
	},
];
