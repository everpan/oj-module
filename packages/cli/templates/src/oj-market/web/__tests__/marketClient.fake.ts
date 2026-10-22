import type { MarketClient } from "../api/client";
// 内存实现 MarketClient（BDD 测试注入用，无需真实后端）。
import type { EnableInput, IndexRow, InstallInput, MarketHistory, TaskRecord, UninstallImpact } from "../types";

export interface FakeState {
	indexRows?: IndexRow[]
	indexError?: Error
	taskRecord?: TaskRecord
	historyRows?: MarketHistory[]
	impact?: UninstallImpact
	enableResult?: { ok: boolean, message: string }
	uninstallResult?: { ok: boolean, message: string }
	installResult?: { task_id: string }
	trustResult?: { result: string, key_id: string, fingerprint: string }
}

export class InMemoryMarketClient implements MarketClient {
	calls: string[] = [];
	constructor(private state: FakeState = {}) {}

	async meta() {
		this.calls.push("meta");
		return { apiVersion: "0.1.0" };
	}

	async index() {
		this.calls.push("index");
		if (this.state.indexError)
			throw this.state.indexError;
		return this.state.indexRows ?? [];
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

	async enable(input: EnableInput) {
		this.calls.push(`enable:${input.name}:${input.enabled}`);
		return this.state.enableResult ?? { ok: true, message: "ok" };
	}

	async history() {
		this.calls.push("history");
		return this.state.historyRows ?? [];
	}

	async uninstallImpact(name: string) {
		this.calls.push(`uninstallImpact:${name}`);
		return this.state.impact ?? { name, affectedRoles: 0, affectedUsers: 0 };
	}

	async uninstall(name: string) {
		this.calls.push(`uninstall:${name}`);
		return this.state.uninstallResult ?? { ok: true, message: "ok" };
	}
}
