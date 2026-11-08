import {
	ProForm,
	ProFormDigit,
	ProFormText,
	ProFormTextArea,
} from "@ant-design/pro-components";
import { BasicContent, FormAvatarItem, useUserStore } from "@oj-module/runtime";
import { Form, Input } from "antd";

export default function Profile() {
	const currentUser = useUserStore();
	// 无头像时不造兜底图：FormAvatarItem 回退 UserOutlined 图标，与 header 一致
	const getAvatarURL = () => currentUser?.avatar || undefined;

	const handleFinish = async () => {
		window.$message?.success("更新基本信息成功");
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
				>
					<FormAvatarItem />
				</Form.Item>
				<ProFormText
					name="username"
					label="用户名"
					disabled
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
