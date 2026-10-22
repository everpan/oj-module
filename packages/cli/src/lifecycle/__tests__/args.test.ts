// BDD：ojm new 参数解析（统一审查 F8——多余位置参数须显式拒绝，不能静默丢弃）。
// 静默丢弃的恶果：ojm new crm erp（手滑/粘贴）只建 crm，用户以为两份都建了。
import { describe, expect, it } from "vitest";
import { parseNewArgs } from "../../args";

describe("parseNewArgs", () => {
	it("name + 旗标组合", () => {
		expect(parseNewArgs(["crm"])).toEqual({ name: "crm", layout: undefined, api: false });
		expect(parseNewArgs(["crm", "--layout", "none", "--api"])).toEqual({ name: "crm", layout: "none", api: true });
		expect(parseNewArgs([])).toEqual({ name: undefined, layout: undefined, api: false });
	});

	it("多余位置参数 → 报错而非静默丢弃", () => {
		expect(() => parseNewArgs(["crm", "erp"])).toThrow(/只接受一个方案名/);
	});

	it("非法 --layout 值 → 报错", () => {
		expect(() => parseNewArgs(["crm", "--layout", "sidebar"])).toThrow(/container \| none/);
	});
});
