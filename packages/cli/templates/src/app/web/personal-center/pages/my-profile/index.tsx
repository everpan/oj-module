import {
	ProForm,
	ProFormDigit,
	ProFormText,
	ProFormTextArea,
} from "@ant-design/pro-components";
import { BasicContent, FormAvatarItem, useUserStore } from "@oj-module/runtime";
import { App, Form, Input } from "antd";
import { useTranslation } from "react-i18next";

import { personalCenterProfilePost } from "../../__client";

export default function Profile() {
	const { t } = useTranslation();
	const currentUser = useUserStore();
	const { message } = App.useApp();
	const getAvatarURL = () => {
		if (currentUser) {
			if (currentUser.avatar) {
				return currentUser.avatar;
			}
			const url = "https://avatar.vercel.sh/blur.svg?text=2";
			return url;
		}
		return "";
	};

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
					rules={[
						{
							required: true,
							message: t("personal-center:profile.avatarRequired"),
						},
					]}
				>
					<FormAvatarItem />
				</Form.Item>
				<ProFormText
					name="username"
					label={t("personal-center:profile.username")}
					rules={[
						{
							required: true,
							message: t("personal-center:profile.usernameRequired"),
						},
					]}
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
		</BasicContent>
	);
};
