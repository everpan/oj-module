import { UploadOutlined, UserOutlined } from "@ant-design/icons";

import { Avatar, Button, Upload } from "antd";
import ImgCrop from "antd-img-crop";
import { useTranslation } from "react-i18next";

import { getUploadApiProvider } from "#src/store/api-provider";
import { resolveApiBase } from "#src/utils/api-base";

interface FormAvatarItemProps {
	value?: string
	onChange?: (value: any) => void
}

export function FormAvatarItem({ value, onChange }: FormAvatarItemProps) {
	const { t } = useTranslation();	// D9：未注册 uploadProvider 时回落内置 root 级 /upload + 死头（沿用现状）。
	const uploadProvider = getUploadApiProvider();
	const uploadAction = uploadProvider?.action ?? `${resolveApiBase()}/upload`;
	const uploadHeaders = uploadProvider?.headers() ?? { authorization: "authorization-text" };

	return (
		<>
			<div className="flex items-center gap-5">
				{/* 无头像时与 layout header（user-menu.tsx）同款 UserOutlined 默认图标 */}
				<Avatar size={100} src={value} icon={<UserOutlined />} />
				<ImgCrop
					rotationSlider
					aspectSlider
					showReset
					showGrid
					cropShape="rect"
				>
					<Upload
						accept="image/*"
						showUploadList={false}
						name="file"
						action={uploadAction}
						headers={uploadHeaders}
						onChange={(info) => {
							// if (info.file.status !== 'uploading') {
							// 	console.log(info.file, info.fileList);
							// }
							if (info.file.status === "done") {
								window.$message?.success(t("common.uploadSuccess", { name: info.file.name }));
								// AC-D16：上传响应为 oj 信封，取 data
								onChange?.((info.file.response as OjEnvelope<string> | undefined)?.data);
							}
							else if (info.file.status === "error") {
								window.$message?.error(t("common.uploadFailed", { name: info.file.name }));
							}
						}}
					>
						<Button icon={<UploadOutlined />}>
							{t("common.avatarChange")}
						</Button>
					</Upload>
				</ImgCrop>
			</div>
		</>
	);
}
