import { Button, Space } from "antd";
import { createElement, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { resolveSiteBase } from "#src/utils/site-base";

interface AppVersionMonitorProps {
	/**
	 * @zh 轮训时间，单位：分钟，默认 1 分钟
	 * @en Polling time, unit: minute, default 1 minute
	 * @default 1
	 */
	checkUpdatesInterval?: number
	// 检查更新的地址
	checkUpdateUrl?: string
}

export function AppVersionMonitor({
	checkUpdatesInterval = 1,
	// 轮询的是站点首页的 ETag（HEAD 请求只比响应头）。必须带部署 base：
	// 子路径部署下裸 "/" 拿到的是宿主机根页面的 ETag，会一直误报「有新版本」。
	checkUpdateUrl = resolveSiteBase(),
}: AppVersionMonitorProps) {
	let isCheckingUpdates = false;
	const { t } = useTranslation();
	const currentVersionTag = useRef("");
	const lastVersionTag = useRef("");
	const timer = useRef<ReturnType<typeof setInterval>>(undefined);

	function handleNotice(versionTag: string) {
		currentVersionTag.current = versionTag;
		window.$notification?.open({
			message: t("widgets.versionMonitorTitle"),
			description: t("widgets.versionMonitorContent"),
			duration: 0,
			btn: (() => {
				return createElement(
					Space,
					{ size: 12 },
					[
						createElement(
							Button,

							{
								onClick() {
									window.$notification?.destroy();
								},
								key: "cancel",
							},
							t("widgets.versionMonitorCancel"),
						),
						createElement(
							Button,
							{
								type: "primary",
								onClick() {
									lastVersionTag.current = currentVersionTag.current;
									location.reload();
								},
								key: "ok",
							},
							t("widgets.versionMonitorConfirm"),
						),
					],
				);
			})(),
		});
	}

	async function getVersionTag(isCache: boolean = false) {
		try {
			if (
				location.hostname === "localhost"
				|| location.hostname === "127.0.0.1"
			) {
				return null;
			}
			const response = await fetch(checkUpdateUrl, {
				cache: !isCache ? "no-cache" : "default",
				method: "HEAD",
			});

			return response.headers.get("etag") || response.headers.get("last-modified");
		}
		catch {
			console.error("Failed to fetch version tag");
			return null;
		}
	}

	async function checkForUpdates() {
		const versionTag = await getVersionTag();
		if (!versionTag) {
			return;
		}

		if (lastVersionTag.current !== versionTag) {
			clearInterval(timer.current);
			handleNotice(versionTag);
		}
	}

	function handleVisibilitychange() {
		if (document.hidden) {
			stop();
		}
		else {
			if (!isCheckingUpdates) {
				isCheckingUpdates = true;
				checkForUpdates().finally(() => {
					isCheckingUpdates = false;
					start();
				});
			}
		}
	}

	async function start() {
		if (checkUpdatesInterval <= 0) {
			return;
		}

		// 首次运行时，获取当前版本号（防止 Nginx 缓存了 index.html）
		if (!lastVersionTag.current) {
			const currentVersionTag = await getVersionTag(true);
			if (!currentVersionTag) {
				return;
			}
			lastVersionTag.current = currentVersionTag;
		}

		timer.current = setInterval(
			checkForUpdates,
			checkUpdatesInterval * 60 * 1000,
		);
	}

	function stop() {
		clearInterval(timer.current);
		timer.current = undefined;
	}

	useEffect(() => {
		/* Mounted */
		start();
		document.addEventListener("visibilitychange", handleVisibilitychange);

		/* UnMounted */
		return () => {
			stop();
			document.removeEventListener("visibilitychange", handleVisibilitychange);
		};
	}, []);
	return null;
}
