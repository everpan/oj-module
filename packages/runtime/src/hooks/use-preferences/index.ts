import { useMemo } from "react";
import { useSystemDark } from "#src/hooks/use-system-theme";
import { DEFAULT_PREFERENCES, usePreferencesStore } from "#src/store/preferences";

/**
 * 包装下用户偏好设置的参数，不需要存储在 localStorage 中，但是为了方便使用的变量可以在这里出现。
 *
 * @returns 返回包含用户偏好设置的对象，包括主题、是否为默认设置、是否为深色主题、是否为浅色主题
 */
export function usePreferences() {
	const preferences = usePreferencesStore();
	const { theme } = preferences;
	// auto = 跟随系统：订阅媒体查询，系统切主题时本 hook 的消费方一起重渲染
	const systemDark = useSystemDark();

	// 是否为默认的用户偏好设置
	const isDefault = useMemo(() => {
		return Object.entries(DEFAULT_PREFERENCES).every(([key, value]) => {
			return preferences[key as keyof typeof preferences] === value;
		});
	}, [preferences]);

	return {
		...preferences,
		isDefault,
		isDark: theme === "dark" || (theme === "auto" && systemDark),
		isLight: theme === "light" || (theme === "auto" && !systemDark),
	};
}
