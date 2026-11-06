// BDD：发布身份推导规则（publish/_shared/identity.ts）。
// 这条规则同时决定 ~/.ojm/keys/<id>/ 的目录名、.sig 的 key_id 与市场卡片上的「发布者」，
// 一旦漂移就是「签出来的身份查不到凭证」这类跨端问题，故用固定用例表钉死。
import { describe, expect, it } from "vitest";
import { assertKeyId, assertProduct, deriveKeyId, encodePerson, KEY_ID_RE } from "../src/app/api/publish/_shared/identity";

describe("发布身份推导", () => {
	it("given 用户名 wecom:everpan 且产品 demo-solution When 推导 Then key_id 用连字符替换冒号", () => {
		expect(deriveKeyId({ product: "demo-solution", username: "wecom:everpan", uid: 7 }))
			.toBe("demo-solution.wecom-everpan");
	});

	it("given 用户名含大写/下划线/连续符号 When 推导 Then 全小写、非白名单字符替换为 - 并折叠", () => {
		expect(encodePerson("WeCom:Ever_Pan", 7)).toBe("wecom-ever-pan");
		expect(encodePerson("--a__b--", 7)).toBe("a-b");
	});

	it("given 用户名归一化后为空（纯中文）When 推导 Then 退化为 u<uid> 且仍是合法 key_id", () => {
		const keyId = deriveKeyId({ product: "demo-solution", username: "张三", uid: 42 });
		expect(keyId).toBe("demo-solution.u42");
		expect(KEY_ID_RE.test(keyId)).toBe(true);
	});

	it("given 产品名为保留名 When 校验 Then 拒绝并提示换成自己的解决方案名", () => {
		for (const reserved of ["oj", "market", "system", "registry"])
			expect(() => assertProduct(reserved)).toThrowError(/保留名/);
	});

	it("given 产品名形状非法 When 校验 Then 拒绝并给出可用示例", () => {
		for (const bad of ["", "  ", "Demo", "1demo", "demo_solution", "demo solution", "a".repeat(65)])
			expect(() => assertProduct(bad)).toThrowError(/400|产品名/);
	});

	it("given 合法产品名带首尾空格 When 校验 Then 去空格后通过", () => {
		expect(assertProduct("  demo-solution  ")).toBe("demo-solution");
	});

	it("given 推导结果 When 自检 Then 满足 C2-37 的 key_id 形状（≥2 段、小写、仅 [a-z0-9-]）", () => {
		const keyId = assertKeyId(deriveKeyId({ product: "demo-solution", username: "wecom:everpan", uid: 7 }));
		expect(keyId.split(".")).toHaveLength(2);
		expect(KEY_ID_RE.test(keyId)).toBe(true);
		expect(() => assertKeyId("nodot")).toThrowError(/不符合 key_id 规则/);
	});
});
