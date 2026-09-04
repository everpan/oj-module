import { UploadOutlined } from "@ant-design/icons";

import { Avatar, Button, Upload } from "antd";
import ImgCrop from "antd-img-crop";

import { getUploadApiProvider } from "#src/store/api-provider";

interface FormAvatarItemProps {
	value?: string
	onChange?: (value: any) => void
}

export function FormAvatarItem({ value, onChange }: FormAvatarItemProps) {
	// const { t } = useTranslation();

	// const onSelect: TreeProps["onSelect"] = (selectedKeys) => {
	// 	onChange?.(selectedKeys);
	// };

	// D9：未注册 uploadProvider 时回落内置 root 级 /upload + 死头（沿用现状）。
	const uploadProvider = getUploadApiProvider();
	const uploadAction = uploadProvider?.action ?? `${import.meta.env.VITE_API_BASE_URL}/upload`;
	const uploadHeaders = uploadProvider?.headers() ?? { authorization: "authorization-text" };

	return (
		<>
			<div className="flex items-center gap-5">
				<Avatar size={100} src={value} />
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
								window.$message?.success(`${info.file.name} file uploaded successfully`);
								// AC-D16：上传响应为 oj 信封，取 data
								onChange?.((info.file.response as OjEnvelope<string> | undefined)?.data);
							}
							else if (info.file.status === "error") {
								window.$message?.error(`${info.file.name} file upload failed.`);
							}
						}}
					>
						<Button icon={<UploadOutlined />}>
							更换头像
						</Button>
					</Upload>
				</ImgCrop>
			</div>
		</>
	);
}
