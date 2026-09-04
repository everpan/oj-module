import { BasicContent, useAuthStore } from "@react-antd-module/runtime";
import { Card, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * 演示页：调后端 /api/web/hello（oj dev/ts 热更，改 api/src 保存即生效）。
 * 业务侧直接消费 oj 原生信封 {code:0,data}；登录链信封由 runtime 适配（D10）。
 *
 * 注意（集中审阅 F6 评估结论）：这里用裸 fetch 是有意的 demo 简化——
 * runtime 不向页面组件暴露请求客户端（scoped client `ctx.utils.request`
 * 只在模块生命周期钩子可用），真实业务模块请把请求收敛到模块自己的
 * api/ 层再封装，不要在页面里散落 fetch。
 */
export default function DemoPage() {
	const { t } = useTranslation();
	const token = useAuthStore(state => state.token);
	const [hello, setHello] = useState<string>("");

	useEffect(() => {
		const controller = new AbortController();
		fetch("/api/web/hello", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
			.then(res => res.json())
			.then((body: { data?: { message?: string } }) => setHello(body?.data?.message ?? ""))
			.catch(() => setHello(""));
		return () => controller.abort();
	}, [token]);

	return (
		<BasicContent>
			<Card title={t("demo:page.title")}>
				<Tag color="success">{t("demo:page.loaded")}</Tag>
				{hello
					? (
						<Typography.Paragraph>
							{t("demo:page.hello")}
							{": "}
							<Typography.Text code>{hello}</Typography.Text>
						</Typography.Paragraph>
					)
					: null}
			</Card>
		</BasicContent>
	);
}
