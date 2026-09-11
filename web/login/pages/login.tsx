import type { FormComponentMapType } from "./form-mode-context";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

import { FORM_COMPONENT_MAP } from "./constants";
import { FormModeContext } from "./form-mode-context";

/**
 * 登录模块内容区（由 runtime 内置登录页模块化而来）：
 * 表单卡片 + formMode 切换（密码/验证码/注册/找回密码）。
 *
 * 视口 / 品牌区 / 工具区 / 页脚由框架级 FullscreenLayout 兜住
 *（handle.layout: "fullscreen"），本页零框架内部 import。
 */
export default function Login() {
	const [formMode, setFormMode] = useState<FormComponentMapType>("login");
	const providedValue = useMemo(() => ({ formMode, setFormMode }), [formMode, setFormMode]);

	return (
		<FormModeContext value={providedValue}>
			<AnimatePresence mode="wait" initial={false}>
				<motion.div
					key={formMode}
					initial={{ x: 30, opacity: 0 }}
					animate={{ x: 0, opacity: 1 }}
					exit={{ x: 0, opacity: 0 }}
					transition={{ duration: 0.3 }}
				>
					{FORM_COMPONENT_MAP[formMode]}
				</motion.div>
			</AnimatePresence>
		</FormModeContext>
	);
}
