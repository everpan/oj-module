// buildBackend spec：宿主 versions.json 双落点（方案安装的 C2-09 前置）+ dev 合并链路。
//
// 安装器按 B-11 布局读 `dist/api/versions.json`（与 manifests.yaml 同层）做 peerRuntime
// 强制比对；而站点壳的 versions.json 落在 dist/web。两者不同源时，新工程 `ojm build`
// 完仍会在 preflight 被 C2-09 拒装——这条用例钉住「同源双写」，防止回归。
//
// 合并链路（2026-11-04）：buildBackend 跑 oj build 前走与 dev 相同的 mergeConfigForDev——
// 全新 clone 的机器只有本机 dev 密钥对，tracked 的 prod ENC（jwt_secret）按设计解不开；
// 直接喂 tracked 会让密封值预检误杀（dev 能跑、build 必挂）。-c 指向 .ojm-tmp-config.yaml，
// 预检对合并产物执行（兜底）；非 jwt 的 ENC 红线不变，fail-closed。
//
// 假 oj 用 vi.mock 进程内实现（不落盘 sh 桩）：sh 脚本在 Windows 上无法被 execFileSync
// 直接 spawn（ENOENT），此前整条 spec 在 win32 基线即挂；进程内桩三平台通吃。
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildBackend, compareVersions, findLockRegressions } from "../build";

// 假 oj 的可控行为（vi.mock 工厂经此桥读取；工厂不能引用普通顶层变量）
const fakeOj = vi.hoisted(() => ({
	/** secret open 能解开的密文集合（真实 oj：与私钥配对的都能解） */
	openable: new Set<string>(["ENC[FAKE]"]),
	/** secret seal 的返回值（真实 oj：返回 ENC[...]） */
	sealOutput: "ENC[FAKE]",
	/** `build --help` 能力探针：是否支持 --module-root */
	supportsModuleRoot: true,
	/** 非 secret 调用的 argv 记录（真实 oj 的 bin/invoked 桩等价物） */
	invoked: [] as string[],
	/** 假 oj build 写出的 manifests.yaml 内容（null = 不动既有锁）；模拟真实 oj 的全量重写 */
	buildLock: null as string | null,
	/** 假 oj build 会整目录重写的版本目录名（模拟真实 oj：先删后按源码重建 api.js） */
	wipeDirs: [] as string[],
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	const mfs = await import("node:fs");
	const mpath = await import("node:path");
	const execFileSync = (file: string, args: readonly string[]): string => {
		const a = [...args];
		if (a[0] === "secret") {
			if (a[1] === "keygen") {
				// --out-dir <dir>：落两枚占位 pem（provision 的幂等探测只查存在与 seal→open 往返）
				const dir = a[3]!;
				mfs.mkdirSync(dir, { recursive: true });
				mfs.writeFileSync(mpath.join(dir, "secrets-private.pem"), "FAKE-PRIVATE");
				mfs.writeFileSync(mpath.join(dir, "secrets-public.pem"), "FAKE-PUBLIC");
				return "";
			}
			if (a[1] === "seal") {
				if (!fakeOj.sealOutput.startsWith("ENC["))
					throw new Error("oj secret seal failed");
				return fakeOj.sealOutput;
			}
			if (a[1] === "open") {
				const value = a[a.length - 1]!;
				if (fakeOj.openable.has(value))
					return "";
				const err = new Error("Command failed") as Error & { stderr: string };
				err.stderr = "oj secret open: aes-gcm open failed (sealed value tampered?): aead::Error";
				throw err;
			}
		}
		if (a[0] === "build" && a[1] === "--help")
			return fakeOj.supportsModuleRoot ? "      --module-root <GLOB>  模块根 glob" : "  -d, --dir <DIR>";
		if (a[0] === "-V")
			return "oj 0.1.84";
		// 真正的 oj build：记 argv（secret 调用不记，便于断言 build 是否真被叫起）
		fakeOj.invoked.push(a.join(" "));
		if (a[0] === "build") {
			const out = a[a.indexOf("-o") + 1]!;
			mfs.mkdirSync(out, { recursive: true });
			// 真实 oj：版本目录整目录重写（旧 web 面/旁车随目录一起没了，只剩本次 api 产物）
			for (const rel of fakeOj.wipeDirs) {
				const dir = mpath.join(out, rel);
				mfs.rmSync(dir, { recursive: true, force: true });
				mfs.mkdirSync(dir, { recursive: true });
				mfs.writeFileSync(mpath.join(dir, "api.js"), "export {};\n");
			}
			if (fakeOj.buildLock !== null)
				mfs.writeFileSync(mpath.join(out, "manifests.yaml"), fakeOj.buildLock);
		}
		return "";
	};
	return { ...actual, execFileSync };
});

beforeEach(() => {
	fakeOj.openable = new Set<string>(["ENC[FAKE]"]);
	fakeOj.sealOutput = "ENC[FAKE]";
	fakeOj.supportsModuleRoot = true;
	fakeOj.invoked = [];
	fakeOj.buildLock = null;
	fakeOj.wipeDirs = [];
});

/** bin/oj 只需存在（buildBackend 的 fs 探测；真正执行走上面的进程内假 oj） */
function stubOjBin(root: string): void {
	fs.mkdirSync(join(root, "bin"), { recursive: true });
	fs.writeFileSync(join(root, "bin", "oj"), "fake-oj-placeholder", "utf-8");
}

function newProject(): string {
	const root = fs.mkdtempSync(join(tmpdir(), "ojm-build-backend-"));
	fs.mkdirSync(join(root, "api", "src", "demo"), { recursive: true });
	fs.writeFileSync(join(root, "api", "src", "demo", "manifest.yaml"), "name: demo\nversion: 0.1.0\n", "utf-8");
	fs.writeFileSync(join(root, "api", "config.yaml"), "server:\n  port: 9778\n", "utf-8");
	// 模拟 oj build 已产出的 manifests.yaml（验证收尾动作不破坏既有产物）
	fs.mkdirSync(join(root, "dist", "api"), { recursive: true });
	fs.writeFileSync(join(root, "dist", "api", "manifests.yaml"), "demo: 0.1.0\n", "utf-8");
	stubOjBin(root);
	return root;
}

describe("given 宿主工程有 api/src When ojm build 后端", () => {
	it("then dist/api/versions.json 与 shell-dist 同源落地（安装器 C2-09 前置）", async () => {
		const root = newProject();

		await buildBackend(root);

		const hostVersions = join(root, "dist", "api", "versions.json");
		expect(fs.existsSync(hostVersions)).toBe(true);
		const parsed = JSON.parse(fs.readFileSync(hostVersions, "utf-8")) as Record<string, string>;
		expect(typeof parsed["@oj-module/runtime"]).toBe("string");
	});

	it("then 既有 oj build 产物不被覆盖（manifests.yaml 原样保留）", async () => {
		const root = newProject();

		await buildBackend(root);

		expect(fs.readFileSync(join(root, "dist", "api", "manifests.yaml"), "utf-8")).toBe("demo: 0.1.0\n");
	});

	it("then -c 指向合并产物（与 dev 同一条 mergeConfigForDev 链路）", async () => {
		const root = newProject();

		await buildBackend(root);

		const merged = join(root, "api", ".ojm-tmp-config.yaml");
		expect(fs.existsSync(merged)).toBe(true);
		expect(fakeOj.invoked[0]).toContain(`-c ${merged}`);
	});
});

describe("重建不得写坏已装锁（oj build 用源码 manifest 全量重写 manifests.yaml）", () => {
	it("given 源码版本低于已装 When ojm build Then fail-closed 并把锁还原", async () => {
		const root = newProject(); // 既有锁 demo: 0.1.0
		fakeOj.buildLock = "demo: 0.0.9\n";

		await expect(buildBackend(root)).rejects.toThrow(/写坏/);
		expect(fs.readFileSync(join(root, "dist", "api", "manifests.yaml"), "utf-8")).toBe("demo: 0.1.0\n");
	});

	it("given 已装条目在源码里消失 When ojm build Then fail-closed（版本目录仍在 = 确实装过）", async () => {
		const root = newProject();
		fs.mkdirSync(join(root, "dist", "api", "demo-0.1.0"), { recursive: true });
		fakeOj.buildLock = "";

		await expect(buildBackend(root)).rejects.toThrow(/条目被移除/);
		expect(fs.readFileSync(join(root, "dist", "api", "manifests.yaml"), "utf-8")).toBe("demo: 0.1.0\n");
	});

	it("given 同名同版本内建 api 目录被 oj build 整目录重写 When ojm build Then 已装方案 web 面与根旁车跨构建保留", async () => {
		const root = newProject();
		const versionDir = join(root, "dist", "api", "demo-0.1.0");
		const faceDir = join(versionDir, "web", "modules", "demo", "0.1.0");
		fs.mkdirSync(faceDir, { recursive: true });
		fs.writeFileSync(join(faceDir, "entry.js"), "console.log(1);\n");
		const sidecar = join(versionDir, ".ojm-module.json");
		fs.writeFileSync(sidecar, "{\"name\":\"demo\",\"version\":\"0.1.0\",\"entry\":\"/modules/demo/0.1.0/entry.js\"}\n");
		fakeOj.wipeDirs = ["demo-0.1.0"];
		fakeOj.buildLock = "demo: 0.1.0\n";

		expect(await buildBackend(root)).toBe(true);

		// 本次构建的 api 产物在，同时旧 web 面/旁车被回填（installed-merge 才能恢复 modules.json 条目）
		expect(fs.existsSync(join(versionDir, "api.js"))).toBe(true);
		expect(fs.readFileSync(join(faceDir, "entry.js"), "utf-8")).toBe("console.log(1);\n");
		expect(fs.readFileSync(sidecar, "utf-8")).toContain("\"name\":\"demo\"");
	});

	it("given 源码版本更高 When ojm build Then 正常放行（升级不受影响）", async () => {
		const root = newProject();
		fakeOj.buildLock = "demo: 0.2.0\n";

		expect(await buildBackend(root)).toBe(true);
		expect(fs.readFileSync(join(root, "dist", "api", "manifests.yaml"), "utf-8")).toBe("demo: 0.2.0\n");
	});

	it("compareVersions 按段数值比较（0.2.10 > 0.2.9）", () => {
		expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
		expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
		expect(compareVersions("0.1.9", "0.2.0")).toBeLessThan(0);
	});

	it("findLockRegressions 忽略「从未装过」的条目消失（无版本目录不误报）", () => {
		expect(findLockRegressions({ a: "1.0.0" }, {}, () => false)).toEqual([]);
	});
});

describe("given 纯前端工程（无 api/src）When ojm build 后端", () => {
	it("then 跳过构建、不产出 dist/api", async () => {
		const root = fs.mkdtempSync(join(tmpdir(), "ojm-build-backend-fe-"));

		expect(await buildBackend(root)).toBe(false);
		expect(fs.existsSync(join(root, "dist", "api"))).toBe(false);
	});
});

/** 新布局工程：src/<name>/{api,web} + 仓库根 config.yaml */
function newModuleRootProject(): string {
	const root = fs.mkdtempSync(join(tmpdir(), "ojm-build-backend-mr-"));
	fs.mkdirSync(join(root, "src", "wiki", "api"), { recursive: true });
	fs.writeFileSync(join(root, "src", "wiki", "api", "manifest.yaml"), "name: wiki\nversion: 0.1.0\n", "utf-8");
	fs.writeFileSync(join(root, "config.yaml"), "server:\n  port: 9778\n", "utf-8");
	stubOjBin(root);
	return root;
}

describe("given module-root 布局 When ojm build 后端", () => {
	it("then 一次调用、单一输出根：--module-root src + -o dist/api（与 -d 互斥）", async () => {
		const root = newModuleRootProject();

		expect(await buildBackend(root)).toBe(true);

		// 逐模块 `-o <tmp>` 会让每个 tmp 各写一份 manifests.yaml，锁与兄弟目录关系全丢
		expect(fakeOj.invoked).toEqual([
			`build -c ${join(root, ".ojm-tmp-config.yaml")} --module-root ${join(root, "src")} -o ${join(root, "dist", "api")} --no-minify`,
		]);
		expect(fs.existsSync(join(root, "dist", "api", "versions.json"))).toBe(true);
	});

	it("then oj 缺 --module-root 能力时 fail-fast，不落任何产物", async () => {
		const root = newModuleRootProject();
		fakeOj.supportsModuleRoot = false;

		await expect(buildBackend(root)).rejects.toThrow(/不支持 --module-root/);
		expect(fakeOj.invoked).toEqual([]); // 没跑 oj build
		expect(fs.existsSync(join(root, "dist", "api"))).toBe(false);
	});
});

/**
 * flat 布局 + tracked 里带「prod 密封」的 config（路径照 ojm init 的产物写）。
 * ENC[AgE0…] 故意不在假 oj 的可解集合里——模拟「全新 clone、只有本机 dev 密钥对、
 * 无生产私钥」的机器：本机密钥只解得开自己 seal 出的 ENC[FAKE]。
 */
function newSealedProject(extraTracked = ""): string {
	const root = newProject();
	fs.writeFileSync(
		join(root, "api", "config.yaml"),
		"auth:\n  jwt_secret: \"ENC[AgE0ZMU2aDKo5CHab4Kl_TtJduXQLwheLVczTPcvm2g]\"\n"
		+ `secrets:\n  private_key_path: ./config/secrets-private.pem\n${
			extraTracked}`,
		"utf-8",
	);
	return root;
}

describe("given 全新 clone、本机只有 dev 密钥对（tracked 的 prod jwt ENC 解不开）When ojm build 后端", () => {
	// 核心回归：dev 能跑、build 必挂的不对称。合并链路里 jwt 被 config.local.yaml 的
	// dev 密文覆盖，tracked 的 prod ENC 仅作 prod 资产被忽略——build 照常出包。
	it("then tracked 的 prod jwt ENC 被 dev 密文覆盖，build 照常出包", async () => {
		const root = newSealedProject();

		expect(await buildBackend(root)).toBe(true);

		const merged = fs.readFileSync(join(root, "api", ".ojm-tmp-config.yaml"), "utf-8");
		expect(merged).toContain("ENC[FAKE]"); // dev jwt（本机密钥密封）
		expect(merged).not.toContain("ENC[AgE0"); // tracked prod ENC 不进合并产物
		expect(fakeOj.invoked[0]).toContain(`-c ${join(root, "api", ".ojm-tmp-config.yaml")}`);
	});

	it("then 注释掉的旧密文不算数（不因一行 `#` 挡住构建）", async () => {
		const root = newProject();
		fs.writeFileSync(
			join(root, "api", "config.yaml"),
			"# auth:\n#   jwt_secret: \"ENC[AgE0ZMU2aDKo5CHab4Kl_TtJduXQLwheLVczTPcvm2g]\"\nserver:\n  port: 9778\n",
			"utf-8",
		);

		expect(await buildBackend(root)).toBe(true);
		expect(fakeOj.invoked[0]).toContain("build -c ");
	});
});

describe("given 合并产物含解不开的密封值 When ojm build 后端", () => {
	// 兜底双保险：config.local.yaml 覆盖进来的非 jwt 密文（local 不经 tracked 红线），
	// 预检对合并产物逐条试解，解不开就停在出包前——oj build 读不动 config 只 warn 不失败。
	it("then 停在出包前，不当成一次成功构建，且带上 oj 的原话", async () => {
		const root = newSealedProject();
		// 本机 dev 密钥由假 oj keygen 现场供给；local 覆盖带一条解不开的密文
		fs.writeFileSync(
			join(root, "api", "config.local.yaml"),
			"notify:\n  wecom_enc_key: \"ENC[BAD]\"\n",
			"utf-8",
		);

		await expect(buildBackend(root)).rejects.toThrow(/密封值解不开/);
		await expect(buildBackend(root)).rejects.toThrow(/aes-gcm open failed/);
		expect(fakeOj.invoked).toEqual([]); // 没跑 oj build
	});
});

describe("given tracked 含非 jwt 的解不开密文 When ojm build 后端", () => {
	// 红线不降级：真实生产数据密钥（如 wecom_enc_key）解不开时 build 依然 fail-closed，
	// 且不由 dev 随机密钥重封（防破坏已加密落库数据）。
	it("then 红线抛错，要求提供真实私钥", async () => {
		const root = newSealedProject("notify:\n  wecom_enc_key: \"ENC[AgE0ZMU2aDKo5CHab4Kl_TtJduXQLwheLVczTPcvm2g]\"\n");

		await expect(buildBackend(root)).rejects.toThrow(/没有能解开的私钥/);
		await expect(buildBackend(root)).rejects.toThrow(/wecom_enc_key/);
		expect(fakeOj.invoked).toEqual([]); // 没跑 oj build
	});
});
