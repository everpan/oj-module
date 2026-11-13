import { fetchChangePassword } from "@oj-module/runtime";

import { Alert, Button, Form, Input } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface PasswordValues {
	old_password: string
	new_password: string
	confirm: string
}

/**
 * 个人中心「修改密码」卡片：登录态下的主动自助改密（PUT /api/auth/password，本人 + 旧口令）。
 *
 * 与 `/change-password` 页共用同一后端契约，区别只在入口：那页由 must_change 悬挂期
 * 强制跳转（首登/被管理员重置后），本卡片给「正常登录但想换口令」的人用——此前这类人
 * 在界面上无路可走（用户管理点自己那行是「重置密码」，按设计置灰且后端 assertNotSelf 拒绝）。
 *
 * 成功回调交给页面：后端改密会吊销该用户全部 refresh 并换发 token，本地会话必须一起收尾。
 */
export function ChangePasswordCard({ onDone }: { onDone: () => void | Promise<void> }) {
	const { t } = useTranslation();
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(false);

	async function onFinish(values: PasswordValues) {
		setLoading(true);
		setError(undefined);
		try {
			await fetchChangePassword({ old_password: values.old_password, new_password: values.new_password });
			await onDone();
		}
		catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
		finally {
			setLoading(false);
		}
	}

	return (
		<>
			{error && <Alert style={{ marginBottom: 16 }} type="error" title={error} showIcon />}
			<Form<PasswordValues> name="change-password" layout="vertical" onFinish={onFinish}>
				<Form.Item name="old_password" label={t("personal-center:password.old")} rules={[{ required: true }]}>
					<Input.Password autoComplete="current-password" />
				</Form.Item>
				<Form.Item
					name="new_password"
					label={t("personal-center:password.new")}
					rules={[{ required: true }, { min: 6, message: t("personal-center:password.min") }]}
				>
					<Input.Password autoComplete="new-password" />
				</Form.Item>
				<Form.Item
					name="confirm"
					label={t("personal-center:password.confirm")}
					dependencies={["new_password"]}
					rules={[{ required: true }, ({ getFieldValue }) => ({
						validator: (_, value) => value === getFieldValue("new_password")
							? Promise.resolve()
							: Promise.reject(new Error(t("personal-center:password.mismatch"))),
					})]}
				>
					<Input.Password autoComplete="new-password" />
				</Form.Item>
				<Button type="primary" htmlType="submit" loading={loading}>
					{t("personal-center:password.submit")}
				</Button>
			</Form>
		</>
	);
}
