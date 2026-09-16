import type { UploadProps } from "antd";
import type { ReactNode } from "react";
import { Avatar, Upload } from "antd";

/**
 * 头像输入（登录/注册/profile 通用）。
 *
 * antd Upload 包 Avatar 的受控组合：选中文件经 onChange 抛给宿主（受控），
 * 展示值取 value（URL）。类型/大小校验在 beforeUpload 内完成，非法文件
 * 不上传也不触发 onChange（onError 可感知原因）。零 store、零第三方依赖。
 */
export interface AvatarInputProps {
	/** 当前头像 URL（受控展示值） */
	value?: string
	/** 宿主选择合法文件后的回调（上传/持久化由宿主负责） */
	onChange?: (file: File) => void
	/** 校验失败回调（类型/大小不符） */
	onError?: (reason: "type" | "size") => void
	/** 头像尺寸（px，默认 96） */
	size?: number
	/** 头像形状（默认 circle） */
	shape?: "circle" | "square"
	disabled?: boolean
	/** accept 透传（默认 image/*） */
	accept?: string
	/** 单文件大小上限（MB，默认 2） */
	maxSizeMB?: number
	/** 无头像时的占位内容（默认首字符或「上传」） */
	placeholder?: ReactNode
}

export function AvatarInput({
	value,
	onChange,
	onError,
	size = 96,
	shape = "circle",
	disabled = false,
	accept = "image/*",
	maxSizeMB = 2,
	placeholder,
}: AvatarInputProps) {
	const handleBeforeUpload: UploadProps["beforeUpload"] = (file) => {
		const isImage = file.type.startsWith("image/");
		if (!isImage) {
			onError?.("type");
			return Upload.LIST_IGNORE;
		}
		const isWithinSize = file.size / 1024 / 1024 <= maxSizeMB;
		if (!isWithinSize) {
			onError?.("size");
			return Upload.LIST_IGNORE;
		}
		onChange?.(file);
		// 受控组件：不走 antd 内置上传，只借它的文件选择交互
		return false;
	};

	return (
		<Upload
			accept={accept}
			beforeUpload={handleBeforeUpload}
			disabled={disabled}
			maxCount={1}
			showUploadList={false}
		>
			<Avatar
				shape={shape}
				size={size}
				src={value}
				style={{ cursor: disabled ? "not-allowed" : "pointer" }}
			>
				{placeholder ?? "上传"}
			</Avatar>
		</Upload>
	);
}
