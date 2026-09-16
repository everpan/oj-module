import type { PasswordCriterion } from "./criteria";

import { Flex, theme, Typography } from "antd";
import { useMemo } from "react";
import { DEFAULT_CRITERIA } from "./criteria";

/**
 * 密码强度校验条（plane PasswordStrengthIndicator 的 ojm 重写版）。
 *
 * 与 plane 版差异：plane 依赖 @plane/constants + @plane/utils + propel 图标，
 * 均不可移植；此处自包含评分逻辑，颜色一律取 antd 语义 token
 * （colorError / colorWarning / colorSuccess / colorFillTertiary），零第三方依赖。
 * 纯展示、props 驱动、零 store —— 登录/注册页直接用。
 */

export interface PasswordStrengthProps {
	/** 当前密码值（受控） */
	password: string
	/** 是否显示判据勾选列表（默认 true） */
	showCriteria?: boolean
	/** 判据列表，覆盖 DEFAULT_CRITERIA（i18n 场景传翻译后的 label） */
	criteria?: PasswordCriterion[]
}

interface StrengthLevel {
	activeBars: number
	message: string
	color: string
}

export function PasswordStrength({ password, showCriteria = true, criteria = DEFAULT_CRITERIA }: PasswordStrengthProps) {
	const { token } = theme.useToken();

	const level: StrengthLevel = useMemo(() => {
		if (!password)
			return { activeBars: 0, message: "", color: token.colorFillTertiary };
		const passed = criteria.filter(c => c.test(password)).length;
		if (passed <= 2)
			return { activeBars: 1, message: "密码强度：弱", color: token.colorError };
		if (passed <= 4)
			return { activeBars: 2, message: "密码强度：中", color: token.colorWarning };
		return { activeBars: 3, message: "密码强度：强", color: token.colorSuccess };
	}, [password, criteria, token]);

	if (!password && !showCriteria)
		return null;

	return (
		<Flex vertical gap={8}>
			{password && (
				<Flex vertical gap={4}>
					<Flex gap={4}>
						{[0, 1, 2].map(i => (
							<div
								key={i}
								style={{
									height: 4,
									flex: 1,
									borderRadius: 2,
									backgroundColor: i < level.activeBars ? level.color : token.colorFillTertiary,
								}}
							/>
						))}
					</Flex>
					<Typography.Text style={{ color: level.color, fontSize: 12 }}>{level.message}</Typography.Text>
				</Flex>
			)}
			{showCriteria && (
				<Flex wrap gap={8}>
					{criteria.map((c) => {
						const valid = c.test(password);
						return (
							<Typography.Text key={c.key} style={{ fontSize: 12, color: valid ? token.colorSuccess : token.colorTextTertiary }}>
								{valid ? "✓ " : "· "}
								{c.label}
							</Typography.Text>
						);
					})}
				</Flex>
			)}
		</Flex>
	);
}
