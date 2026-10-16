import type { FormComponentMapType } from "./form-mode-context";

import { fetchLoginMethods } from "@oj-module/runtime";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "antd";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FORM_COMPONENT_MAP } from "./constants";
import { FormModeContext } from "./form-mode-context";

/**
 * 登录模块内容区（由 runtime 内置登录页模块化而来）：
 * 表单卡片 + formMode 切换（密码/验证码/注册/找回密码）。
 * C5：登录方式 Tabs 由后端 system/login-methods 驱动（AC2-2），
 * local = 既有表单；ldap/sso 为占位，能力随阶段 D 落地。
 *
 * 视口 / 品牌区 / 工具区 / 页脚由框架级 FullscreenLayout 兜住
 *（handle.layout: "fullscreen"），本页零框架内部 import。
 */
export default function Login() {
	const [formMode, setFormMode] = useState<FormComponentMapType>("login");
	const [method, setMethod] = useState<"local" | "ldap" | "sso">("local");
	const providedValue = useMemo(() => ({ formMode, setFormMode }), [formMode, setFormMode]);
	const { t } = useTranslation();
	const { data: loginMethods } = useQuery({
		queryKey: ["login-methods"],
		queryFn: fetchLoginMethods,
		retry: false,
		staleTime: 60_000,
	});
	const methods = loginMethods?.methods ?? ["local"];

	return (
		<FormModeContext value={providedValue}>
			{methods.length > 1 && (
				<Tabs
					activeKey={method}
					onChange={k => setMethod(k as typeof method)}
					items={methods.map(m => ({ key: m, label: t(`login:method.${m}`) }))}
					className="mb-4"
				/>
			)}
			<AnimatePresence mode="wait" initial={false}>
				<motion.div
					key={formMode === "mustChange" ? "mustChange" : `${method}:${formMode}`}
					initial={{ x: 30, opacity: 0 }}
					animate={{ x: 0, opacity: 1 }}
					exit={{ x: 0, opacity: 0 }}
					transition={{ duration: 0.3 }}
				>
					{formMode === "mustChange"
						? FORM_COMPONENT_MAP.mustChange
						: method === "local"
							? FORM_COMPONENT_MAP[formMode]
							: <p className="text-colorTextSecondary">{t(`login:method.${method}Pending`)}</p>}
				</motion.div>
			</AnimatePresence>
		</FormModeContext>
	);
}
