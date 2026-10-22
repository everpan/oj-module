import type { ButtonProps, MenuProps } from "antd";

import { LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { useKeyPress } from "ahooks";
import { Avatar, Dropdown } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { BasicButton } from "#src/components/basic-button";

import { RiAccountCircleLine } from "#src/icons";
import { loginPath } from "#src/router/extra-info";
import { useAuthStore } from "#src/store/auth";
import { useUserStore } from "#src/store/user";
import { cn } from "#src/utils/cn";
import { isWindowsOs } from "#src/utils/is-windows-os";

export function UserMenu({ ...restProps }: ButtonProps) {
	const navigate = useNavigate();
	const { t } = useTranslation();
	const avatar = useUserStore(state => state.avatar);
	const logout = useAuthStore(state => state.logout);

	const onClick: MenuProps["onClick"] = async ({ key }) => {
		if (key === "logout") {
			await logout();
			navigate(loginPath);
		}
		if (key === "personal-center") {
			navigate("/personal-center/my-profile");
		}
	};

	const altView = useMemo(() => isWindowsOs() ? "Alt" : "⌥", []);
	const items: MenuProps["items"] = [
		{
			label: t("personal-center:menu.personalCenter"),
			key: "personal-center",
			icon: <RiAccountCircleLine />,
			extra: `${altView}P`,
		},
		{
			label: t("authority.logout"),
			key: "logout",
			icon: <LogoutOutlined />,
			extra: `${altView}Q`,
		},
	];

	useKeyPress(["alt.P"], () => {
		navigate("/personal-center/my-profile");
	});

	useKeyPress(["alt.Q"], () => {
		onClick({ key: "logout" } as any);
	});

	return (
		<Dropdown
			menu={{ items, onClick }}
			arrow={false}
			placement="bottomRight"
			trigger={["click"]}
		>
			<BasicButton
				type="text"
				{...restProps}
				className={cn(restProps.className, "rounded-full px-1")}
			>
				{/* 空串转 undefined + 默认人形图标：antd 对 src="" 渲染 <img src="">
				导致头像空白，无 src 时默认又只渲染空 span（host 免登录链
				userStore.avatar 恒为初始 ""，layout e2e I2 暴露） */}
				<Avatar src={avatar || undefined} icon={<UserOutlined />} />
			</BasicButton>
		</Dropdown>
	);
}
