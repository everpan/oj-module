import type { TFunction } from "i18next";

import { Button, Card, Result } from "antd";
import { useNavigate } from "react-router";

import { isMustChange } from "./errors";

/**
 * 页面级「无权限」面板：路由可进但 API 403——规格 §4：渲染引导而非落 error
 * boundary。路由级门禁由 requiredRoles 过滤（B16）负责，本组件不承担。
 *
 * 特判 must_change（后端对未改密用户拒绝全部管理端点）：渲染改密引导卡跳
 * /change-password——表单唯一真源在 login 模块，此处不重复实现（DRY）。
 */
export function ForbiddenPanel({ t, error }: { t: TFunction, error?: unknown }) {
	const navigate = useNavigate();

	if (isMustChange(error)) {
		return (
			<Card style={{ maxWidth: 480, margin: "48px auto" }}>
				<Result
					status="warning"
					title={t("system:err.mustChange.title")}
					subTitle={t("system:err.mustChange.hint")}
					extra={(
						<Button type="primary" onClick={() => navigate("/change-password")}>
							{t("system:err.mustChange.go")}
						</Button>
					)}
				/>
			</Card>
		);
	}
	return <Result status="403" title={t("system:err.forbidden")} />;
}
