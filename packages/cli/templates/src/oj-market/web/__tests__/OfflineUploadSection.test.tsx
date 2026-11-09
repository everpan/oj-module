// BDD：发布管理「离线包上传」区（2026-11-10 round 3：内网手动上传升级）。
// 运维携带已签分发包（tgz + .sig）上传入库；未审指纹放行（trusted=false warning），
// 安装时才做信任判定。前端预校验同名配对，不发无效请求。
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OfflineUploadSection } from "../publish/pages/offline-upload";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";

const RESULT = {
	ok: true,
	name: "demo-solution",
	version: "0.2.0",
	sha256: "a".repeat(64),
	size: 1024,
	key_id: "crm.author",
	fingerprint: "ab".repeat(32),
	trusted: true,
	idempotent: false,
};

function tgzFile(): File {
	return new File([new Uint8Array([1, 2, 3])], "demo-solution-0.2.0.tgz", { type: "application/gzip" });
}

function sigFile(name = "demo-solution-0.2.0.tgz.sig"): File {
	return new File([new TextEncoder().encode(JSON.stringify({ alg: "Ed25519" }))], name, { type: "application/json" });
}

/** antd Upload（rc-upload）文件输入：页面上两个 input[type=file]，顺序 [tgz, sig] */
function pick(input: Element, file: File) {
	fireEvent.change(input, { target: { files: [file] } });
}

async function renderAndPick(client: InMemoryMarketClient) {
	renderWithProviders(<OfflineUploadSection />, client);
	const inputs = document.querySelectorAll("input[type=\"file\"]");
	expect(inputs.length).toBeGreaterThanOrEqual(2);
	pick(inputs[0]!, tgzFile());
	pick(inputs[1]!, sigFile());
	return inputs;
}

describe("发布管理「离线包上传」区", () => {
	it("trusted:true：配对两文件上传入库，渲染 name@version + 「已入库」tag + 可复制指纹", async () => {
		const client = new InMemoryMarketClient({ uploadPackageResult: RESULT });
		await renderAndPick(client);
		fireEvent.click(screen.getByText("上传入库"));
		await screen.findByText("demo-solution@0.2.0");
		expect(screen.getByText("发布方已入库")).toBeTruthy();
		expect(screen.getByText("ab".repeat(32))).toBeTruthy();
		expect(client.calls).toContain("uploadPackage:demo-solution-0.2.0.tgz");
	});

	it("trusted:false：上传照常成功但渲染「未入库」warning（安装时才做信任判定）", async () => {
		const client = new InMemoryMarketClient({ uploadPackageResult: { ...RESULT, trusted: false } });
		await renderAndPick(client);
		fireEvent.click(screen.getByText("上传入库"));
		await screen.findByText("demo-solution@0.2.0");
		expect(screen.getByText("发布方未入库：安装时将停待信任确认，审核后重试安装即可")).toBeTruthy();
	});

	it("上传失败：Alert errorText 渲染人话，不崩溃", async () => {
		const client = new InMemoryMarketClient({ uploadPackageError: new Error("409 已存在且字节不一致") });
		await renderAndPick(client);
		fireEvent.click(screen.getByText("上传入库"));
		await screen.findByText("409 已存在且字节不一致");
	});

	it("配对不齐（.sig 与 tgz 不同名）：前端预校验拦截，不发请求", async () => {
		const client = new InMemoryMarketClient({ uploadPackageResult: RESULT });
		renderWithProviders(<OfflineUploadSection />, client);
		const inputs = document.querySelectorAll("input[type=\"file\"]");
		pick(inputs[0]!, tgzFile());
		pick(inputs[1]!, sigFile("other-9.9.9.tgz.sig"));
		fireEvent.click(screen.getByText("上传入库"));
		await waitFor(() => expect(screen.getByText("两文件须同名配对：.sig 文件名应为「demo-solution-0.2.0.tgz.sig」")).toBeTruthy());
		expect(client.calls.filter(c => c.startsWith("uploadPackage"))).toHaveLength(0);
	});
});
