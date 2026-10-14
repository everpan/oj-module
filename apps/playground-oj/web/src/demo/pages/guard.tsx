import { BasicContent, useTabsStore } from "@oj-module/runtime";
import { Alert, Card, Input, Modal } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** 本页页签 key = 路由路径（tabbar 以路由路径为页签 key） */
const TAB_KEY = "/demo/guard";

/**
 * beforeClose 未保存守卫示例页（ojm 0.1.18 Item 3）。
 *
 * 表单 dirty 时经 addTab merge 语义给本页页签注册关闭守卫：任一关闭动作
 * （单个/右/左/其他/全部）触发前先 await 守卫，弹确认框由用户裁决；
 * 表单保存或还原后传 null 清除守卫。守卫 await 期间页签保留、组件挂载。
 */
export default function DemoGuardPage() {
	const { t } = useTranslation();
	const [value, setValue] = useState("");
	const [confirmResolver, setConfirmResolver] = useState<((ok: boolean) => void) | null>(null);
	const addTab = useTabsStore(s => s.addTab);
	const dirty = value.trim().length > 0;

	useEffect(() => {
		addTab(TAB_KEY, {
			key: TAB_KEY,
			label: t("demo:menu.guard"),
			// dirty 时挂守卫；干净时传 null 清除（本页独占该页签，清全部安全）
			beforeClose: dirty
				? () => new Promise<boolean>((resolve) => {
					setConfirmResolver(() => resolve);
				})
				: null,
		});
	}, [dirty, addTab, t]);

	return (
		<BasicContent>
			<Card title={t("demo:page.guard.title")}>
				<Alert
					type="info"
					showIcon
					message={t("demo:page.guard.hint")}
					style={{ marginBottom: 16 }}
				/>
				<Input.TextArea
					rows={4}
					value={value}
					placeholder={t("demo:page.guard.placeholder")}
					onChange={e => setValue(e.target.value)}
				/>
			</Card>
			<Modal
				open={confirmResolver !== null}
				title={t("demo:page.guard.modalTitle")}
				okText={t("demo:page.guard.discard")}
				cancelText={t("demo:page.guard.keep")}
				onOk={() => {
					confirmResolver?.(true);
					setConfirmResolver(null);
				}}
				onCancel={() => {
					confirmResolver?.(false);
					setConfirmResolver(null);
				}}
			>
				{t("demo:page.guard.modalBody")}
			</Modal>
		</BasicContent>
	);
}
