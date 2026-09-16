export interface PasswordCriterion {
	key: string
	label: string
	test: (password: string) => boolean
}

/** 默认五项判据（全部通过才算强密码）；可用 criteria 属性整体覆盖 */
export const DEFAULT_CRITERIA: PasswordCriterion[] = [
	{ key: "length", label: "至少 8 个字符", test: p => p.length >= 8 },
	{ key: "lower", label: "包含小写字母", test: p => /[a-z]/.test(p) },
	{ key: "upper", label: "包含大写字母", test: p => /[A-Z]/.test(p) },
	{ key: "digit", label: "包含数字", test: p => /\d/.test(p) },
	{ key: "symbol", label: "包含符号", test: p => /[^A-Z0-9]/i.test(p) },
];
