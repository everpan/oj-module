import {
	ProForm,
	ProFormDigit,
	ProFormText,
	ProFormTextArea,
} from "@ant-design/pro-components";
import { BasicContent, FormAvatarItem, useUserStore } from "@oj-module/runtime";
import { App, Form, Input } from "antd";

import { personalCenterProfilePost } from "../../__client/api";

export default function Profile() {
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
			message.success("更新基本信息成功");
		}
		catch (e) {
			message.error(`更新基本信息失败：${e instanceof Error ? e.message : String(e)}`);
		}
	};

	return (
		<BasicContent className="max-w-md ml-10">
			<h3>我的资料</h3>
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
					label="头像"
					rules={[
						{
							required: true,
							message: "请输入您的昵称!",
						},
					]}
				>
					<FormAvatarItem />
				</Form.Item>
				<ProFormText
					name="username"
					label="用户名"
					rules={[
						{
							required: true,
							message: "请输入您的用户名!",
						},
					]}
				/>
				<ProFormText
					name="email"
					label="邮箱"
					rules={[
						{
							required: true,
							message: "请输入您的邮箱!",
						},
					]}
				/>
				<ProFormDigit
					name="phoneNumber"
					label="联系电话"
					rules={[
						{
							required: true,
							message: "请输入您的联系电话!",
						},
					]}
				>
					<Input type="tel" allowClear />
				</ProFormDigit>
				<ProFormTextArea
					allowClear
					name="description"
					label="个人简介"
					placeholder="个人简介"
				/>
			</ProForm>
		</BasicContent>
	);
};
