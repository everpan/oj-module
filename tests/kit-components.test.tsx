import { AvatarInput, DEFAULT_CRITERIA, PasswordStrength } from "@plane/kit";
import { render, screen } from "@testing-library/react";

import { describe, expect, it } from "vitest";

/**
 * @plane/kit 组件冒烟（M1 T7）。
 *
 * 不追 DOM 细节，只锁两件事：评分分支（弱/中/强映射）与受控 AvatarInput 渲染。
 * 样式细节归 antd token，不值得用快照钉死。
 */
describe("passwordStrength 评分分支", () => {
	it("空密码：只出判据，不出强度条", () => {
		render(<PasswordStrength password="" />);
		expect(screen.queryByText(/密码强度/)).toBeNull();
		expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === `· ${DEFAULT_CRITERIA[0].label}`)).toBeTruthy();
	});

	it("弱密码（仅长度）：1 档提示", () => {
		render(<PasswordStrength password="abcdefgh" />);
		expect(screen.getByText("密码强度：弱")).toBeTruthy();
	});

	it("强密码（五项全过）：3 档提示", () => {
		render(<PasswordStrength password="Abcdefg1!" />);
		expect(screen.getByText("密码强度：强")).toBeTruthy();
	});

	it("criteria 可整体覆盖（i18n 场景）", () => {
		render(<PasswordStrength password="" criteria={[{ key: "len", label: "8+ chars", test: p => p.length >= 8 }]} />);
		expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "· 8+ chars")).toBeTruthy();
	});
});

describe("avatarInput 受控渲染", () => {
	it("无 value 时渲染占位文本，有 value 时头像指向该 URL", () => {
		const { container, rerender } = render(<AvatarInput placeholder="上传头像" />);
		expect(screen.getByText("上传头像")).toBeTruthy();
		rerender(<AvatarInput value="https://example.com/a.png" placeholder="上传头像" />);
		expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/a.png");
	});
});
