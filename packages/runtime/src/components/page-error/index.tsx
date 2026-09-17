import type { FallbackProps } from "react-error-boundary";

import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Result, Space, Typography } from "antd";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
// https://undraw.co/search
// 用 `?url` + <img> 而非 `?react`：`?react` 需要 vite-plugin-svgr，而**分发的 runtime
// lib 构建**（packages/runtime/vite.config.ts）没有该插件（只有根 App 链的 vite.config.ts 有），
// 于是 `?react` 会退化成「URL 字符串」——`<BugFixing />` 变成
// `createElement("data:image/svg+xml,...")` 抛 InvalidCharacterError，
// **兜底页自己崩**，最终只剩 React Router 默认的 "Unexpected Application Error!"。
// 该缺陷长期潜伏（此前壳链无 ErrorBoundary，PageError 从不渲染），
// 一直到 M2a 增量⑥ 把 ErrorBoundary 挂进宿主壳链才被 e2e 目检暴露。
// `?url` 是 vite 内建能力、两链通吃，与同目录 layout/widgets/logo、fullscreen-layout
// 的既有写法一致（runtime 源码里其余三处 SVG 导入都是 `?url`/`?inline`）。
import BugFixingUrl from "#src/assets/svg/undraw-bug-fixing.svg?url";
import { usePreferencesStore } from "#src/store/preferences";

const { VITE_BASE_HOME_PATH } = import.meta.env;

export function PageError({ error, resetErrorBoundary }: FallbackProps) {
	const navigate = useNavigate();
	const { t } = useTranslation();
	const enableDynamicTitle = usePreferencesStore(state => state.enableDynamicTitle);

	const goHome = () => {
		resetErrorBoundary();
		navigate(VITE_BASE_HOME_PATH);
	};
	const refresh = () => {
		location.reload();
	};

	useEffect(() => {
		if (enableDynamicTitle) {
			document.title = t("exception.pageErrorTitle");
		}
	}, [enableDynamicTitle]);

	return (
		<Result
			status="error"
			icon={(
				<div className="w-7/12 md:w-3/12 xl:w-2/12 inline-block">
					<img src={BugFixingUrl} alt="" className="w-full" />
				</div>
			)}
			title={(error as any)?.message ?? t("exception.pageErrorTitle")}
			// subTitle={error.stack}
			extra={(
				<Space size={20}>
					<Button
						icon={<ArrowLeftOutlined />}
						type="primary"
						onClick={goHome}
					>
						{t("common.backHome")}
					</Button>
					<Button
						icon={<ReloadOutlined rotate={90} />}
						onClick={refresh}
					>
						{t("common.refresh")}
					</Button>
				</Space>
			)}
		>
			<Typography.Paragraph type="warning" className="text-center">
				{(error as any)?.stack}
			</Typography.Paragraph>

		</Result>
	);
}
