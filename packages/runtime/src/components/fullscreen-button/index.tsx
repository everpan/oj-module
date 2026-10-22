import type { ButtonProps } from "antd";
import type { RefObject } from "react";
import { FullscreenExitOutlined, FullscreenOutlined } from "@ant-design/icons";
import { useFullscreen } from "ahooks";

import { BasicButton } from "#src/components/basic-button";

export interface FullscreenButtonProps extends Omit<ButtonProps, "target"> {
	target: HTMLElement | (() => Element) | RefObject<Element>
	fullscreenIcon?: React.ReactNode
	fullscreenExitIcon?: React.ReactNode
}

/**
 * 全屏按钮组件
 *
 * @param target 组件属性（解构自 FullscreenButtonProps）
 * @param target.target 全屏目标元素
 * @param target.fullscreenIcon 全屏时图标
 * @param target.fullscreenExitIcon 退出全屏时图标
 * @returns 返回全屏按钮组件
 */
export const FullscreenButton: React.FC<FullscreenButtonProps> = ({
	target,
	fullscreenIcon,
	fullscreenExitIcon,
	...restProps
}) => {
	const [isFullscreen, { toggleFullscreen }] = useFullscreen(target);

	return (
		<BasicButton
			type="text"
			{...restProps}
			icon={!isFullscreen ? (fullscreenIcon ?? <FullscreenOutlined />) : (fullscreenExitIcon ?? <FullscreenExitOutlined />)}
			onClick={toggleFullscreen}
		/>
	);
};
