import type { MarketClient } from "../api/client";
// 内存实现 MarketClient（BDD 测试注入用，无需真实后端）。
import type { EnableInput, IndexPage, InstallInput, MarketHistory, McpCatalogResult, PurgeHistoryResult, ReleasePage, TaskRecord, TrustReviewItem, UninstallImpact, UploadPackageResult } from "../types";

export interface FakeState {
	indexPage?: IndexPage
	indexError?: Error
	taskRecord?: TaskRecord
	historyRows?: MarketHistory[]
	releasePage?: ReleasePage
	impact?: UninstallImpact
	enableResult?: { ok: boolean, message: string }
	uninstallResult?: { ok: boolean, message: string }
	installResult?: { task_id: string }
	trustResult?: { result: string, key_id: string, fingerprint: string }
	/** 信任审核区数据源（发布管理页「信任审核」列表） */
	trustReviewRows?: TrustReviewItem[]
	/** 非 superadmin 视角：403 → 整个区不渲染 */
	trustReviewError?: Error
	/** 离线包上传结果（trusted=false 渲染未入库 warning） */
	uploadPackageResult?: UploadPackageResult
	/** 离线包上传失败（Alert errorText 面） */
	uploadPackageError?: Error
	/** 信任库列表（离线上传区可见性探测面） */
	trustKeysResult?: { keys: Array<{ key_id: string, public_key: string }>, note: string | null }
	/** 非 superadmin 探测：403 → 整个上传区不渲染 */
	trustKeysError?: Error
	/** 删除「未安装成功版本」的返回；缺省为删除成功的常态 */
	purgeResult?: PurgeHistoryResult
	purgeError?: Error
	/** MCP 工具目录（管理页状态卡/工具表数据源，20261110-1027 §4.3） */
	mcpCatalogResult?: McpCatalogResult
	/** catalog 拉取失败（页面错误面数据） */
	mcpCatalogError?: Error
}

export class InMemoryMarketClient implements MarketClient {
	calls: string[] = [];
	constructor(private state: FakeState = {}) {}

	async meta() {
		this.calls.push("meta");
		return { apiVersion: "0.1.0" };
	}

	async index(input: { page?: number, size?: number } = {}) {
		this.calls.push(`index:${input.page ?? 1}:${input.size ?? 20}`);
		if (this.state.indexError)
			throw this.state.indexError;
		return this.state.indexPage ?? { list: [], total: 0, page: 1, size: 20 };
	}

	async install(input: InstallInput) {
		this.calls.push(`install:${input.name}@${input.version ?? "latest"}`);
		return this.state.installResult ?? { task_id: "t1" };
	}

	async task(id: string) {
		this.calls.push(`task:${id}`);
		return this.state.taskRecord ?? ({
			id,
			name: "",
			version: "",
			status: "done",
			stage: "done",
			progress: 100,
			message: "ok",
			stages: [],
			startedAt: 0,
		} as TaskRecord);
	}

	async trust(taskId: string) {
		this.calls.push(`trust:${taskId}`);
		return this.state.trustResult ?? { result: "added", key_id: "k1", fingerprint: "f".repeat(64) };
	}

	async trustReview() {
		this.calls.push("trustReview");
		if (this.state.trustReviewError)
			throw this.state.trustReviewError;
		return this.state.trustReviewRows ?? [];
	}

	async trustKeys() {
		this.calls.push("trustKeys");
		if (this.state.trustKeysError)
			throw this.state.trustKeysError;
		return this.state.trustKeysResult ?? { keys: [], note: null };
	}

	async uploadPackage(input: { name: string, tgz: Blob, sig: Blob }) {
		this.calls.push(`uploadPackage:${input.name}`);
		if (this.state.uploadPackageError)
			throw this.state.uploadPackageError;
		return this.state.uploadPackageResult ?? { ok: true, name: "demo-solution", version: "0.1.0", sha256: "a".repeat(64), size: 1, key_id: "demo.author", fingerprint: "f".repeat(64), trusted: true, idempotent: false };
	}

	async enable(input: EnableInput) {
		this.calls.push(`enable:${input.name}:${input.enabled}`);
		return this.state.enableResult ?? { ok: true, message: "ok" };
	}

	async history() {
		this.calls.push("history");
		return this.state.historyRows ?? [];
	}

	async releases(input: { page?: number, limit?: number } = {}) {
		this.calls.push(`releases:${input.page ?? 1}:${input.limit ?? 20}`);
		return this.state.releasePage ?? { list: [], total: 0, page: 1, size: 20 };
	}

	async uninstallImpact(name: string) {
		this.calls.push(`uninstallImpact:${name}`);
		return this.state.impact ?? { name, affectedRoles: 0, affectedUsers: 0 };
	}

	async uninstall(name: string) {
		this.calls.push(`uninstall:${name}`);
		return this.state.uninstallResult ?? { ok: true, message: "ok" };
	}

	async purgeHistory(input: { name: string, version: string }) {
		this.calls.push(`purgeHistory:${input.name}@${input.version}`);
		if (this.state.purgeError)
			throw this.state.purgeError;
		return this.state.purgeResult ?? { ok: true, deleted: 1, removedDir: false, message: "ok" };
	}

	async mcpCatalog() {
		this.calls.push("mcpCatalog");
		if (this.state.mcpCatalogError)
			throw this.state.mcpCatalogError;
		return this.state.mcpCatalogResult ?? { status: "unmounted" as const, groups: [] };
	}
}
