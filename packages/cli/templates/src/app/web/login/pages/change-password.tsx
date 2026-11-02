import { fetchChangePassword } from "@oj-module/runtime";

import { Alert, Button, Form, Input, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

interface ChangePwdValues {
	old_password: string
	new_password: string
	confirm: string
}

/**
 * 首登/重置后强制改密页（AC1-27）：must_change 悬挂期唯一可用写端是
 * PUT /api/auth/password（后端对未改密用户拒绝其余全部端点）。登录响应
 * data.user.must_change / 管理面 403 msg 均会引导到此页。走 runtime 全局
 * request 出口（fetchChangePassword）——auth 无 web 模块、无 client 宿。
 */
export default function ChangePasswordPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(false);

	async function onFinish(values: ChangePwdValues) {
		setLoading(true);
		setError(undefined);
		try {
			await fetchChangePassword({ old_password: values.old_password, new_password: values.new_password });
			// 改密级联吊销 refresh，旧会话状态陈旧——回登录页重新认证
			navigate("/login");
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
			<Typography.Title level={3}>
				{t("login:page.changePwd.title")}
			</Typography.Title>
			<Typography.Paragraph type="secondary">
				{t("login:page.changePwd.hint")}
			</Typography.Paragraph>
			{error && <Alert style={{ marginBottom: 16 }} type="error" message={error} showIcon />}
			<Form<ChangePwdValues> layout="vertical" onFinish={onFinish}>
				<Form.Item name="old_password" label={t("login:page.changePwd.old")} rules={[{ required: true }]}>
					<Input.Password autoFocus />
				</Form.Item>
				<Form.Item name="new_password" label={t("login:page.changePwd.new")} rules={[{ required: true }, { min: 6 }]} extra={t("login:page.changePwd.min")}>
					<Input.Password />
				</Form.Item>
				<Form.Item
					name="confirm"
					label={t("login:page.changePwd.confirm")}
					dependencies={["new_password"]}
					rules={[{ required: true }, ({ getFieldValue }) => ({
						validator: (_, value) => value === getFieldValue("new_password") ? Promise.resolve() : Promise.reject(new Error(t("login:page.changePwd.mismatch"))),
					})]}
				>
					<Input.Password />
				</Form.Item>
				<Button type="primary" htmlType="submit" block loading={loading}>
					{t("login:page.changePwd.submit")}
				</Button>
			</Form>
		</>
	);
}
