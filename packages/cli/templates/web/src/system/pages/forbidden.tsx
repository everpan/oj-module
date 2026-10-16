import type { TFunction } from "i18next";

import { Result } from "antd";

/**
 * 页面级「无权限」面板：路由可进但 API 403（如 admin 手输 URL 碰 superadmin-only
 * 操作）——规格 §4：渲染无权限而非落 error boundary。路由级门禁由
 * requiredRoles 过滤（B16）负责，本组件不承担。
 */
export function ForbiddenPanel({ t }: { t: TFunction }) {
	return <Result status="403" title={t("system:err.forbidden")} />;
}
