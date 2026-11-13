import {
	ProForm,
	ProFormDigit,
	ProFormText,
	ProFormTextArea,
} from "@ant-design/pro-components";
import { BasicContent, FormAvatarItem, useAuthStore, useUserStore } from "@oj-module/runtime";
import { App, Form, Input, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { personalCenterProfilePost } from "../../__client";
import { ChangePasswordCard } from "./change-password-card";

export default function Profile() {
	const { t } = useTranslation();
	const currentUser = useUserStore();
	const { message } = App.useApp();
	const logout = useAuthStore(s => s.logout);
	const navigate = useNavigate();
	// 无头像时不造兜底图：FormAvatarItem 回退 UserOutlined 图标，与 header 一致
	const getAvatarURL = () => currentUser?.avatar || undefined;

	// 真实入库：POST /api/personal-center/profile（只传资料四字段，avatar 走 upload 通道），
	// 成功后重拉 user-info 刷新全局 store（表单 initialValues 随之更新）。
	const handleFinish = async (values: {
		username?: string
		email?: string
		phoneNumber?: string
		description?: string
	}) => {
		try {
			await personalCenterProfilePost({
				username: values.username,
				email: values.email,
				phoneNumber: values.phoneNumber,
				description: values.description,
			});
			await useUserStore.getState().getUserInfo();
			message.success(t("personal-center:profile.updated"));
		}
		catch (e) {
			message.error(t("personal-center:profile.updateFailed", { message: e instanceof Error ? e.message : String(e) }));
		}
	};

	// 改密成功 = 后端已吊销该用户全部 refresh 并换发 token：本地会话必须一起收尾，
	// 否则守卫会拿着已失效的 token 在首页与 401 之间打转
	const handlePasswordChanged = async () => {
		message.success(t("personal-center:password.success"));
		try {
			await logout();
		}
		finally {
			// 登出的服务端吊销是尽力而为，本地清空后必须回登录页（否则停在已失效的会话里）
			navigate("/login");
		}
	};

	return (
		<BasicContent className="max-w-md ml-10">
			<h3>{t("personal-center:profile.title")}</h3>
			<ProForm
				layout="vertical"
				onFinish={handleFinish}
				initialValues={{
					...currentUser,
					avatar: getAvatarURL(),
				}}
				requiredMark
			>
				<Form.Item
					name="avatar"
					label={t("personal-center:profile.avatar")}
				>
					<FormAvatarItem />
				</Form.Item>
				<ProFormText
					name="username"
					label={t("personal-center:profile.username")}
					disabled
					rules={[
						{
							required: true,
							message: t("personal-center:profile.usernameRequired"),
						},
					]}
				/>
				<ProFormText
					name="displayName"
					label={t("personal-center:profile.displayName")}
					disabled
				/>
				<ProFormText
					name="email"
					label={t("personal-center:profile.email")}
					rules={[
						{
							required: true,
							message: t("personal-center:profile.emailRequired"),
						},
					]}
				/>
				<ProFormDigit
					name="phoneNumber"
					label={t("personal-center:profile.phoneNumber")}
					rules={[
						{
							required: true,
							message: t("personal-center:profile.phoneNumberRequired"),
						},
					]}
				>
					<Input type="tel" allowClear />
				</ProFormDigit>
				<ProFormTextArea
					allowClear
					name="description"
					label={t("personal-center:profile.description")}
					placeholder={t("personal-center:profile.descriptionPlaceholder")}
				/>
			</ProForm>
			<h4 style={{ marginTop: 32 }}>
				{t("personal-center:password.title")}
			</h4>
			<Typography.Paragraph type="secondary">
				{t("personal-center:password.hint")}
			</Typography.Paragraph>
			<ChangePasswordCard onDone={handlePasswordChanged} />
		</BasicContent>
	);
};
