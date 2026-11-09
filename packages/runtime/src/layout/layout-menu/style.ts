import { createUseStyles } from "react-jss";

/**
 * 显式标注返回的 classes 形状（P3.5 / TS2883）：
 * 推断类型会引用 jss 的 Classes（非直接依赖，声明不可移植），
 * 这里用结构化等价类型 Record<C, string> 替代，声明产物零额外依赖。
 *
 * 折叠态选中分组（.ant-menu-submenu-selected）的高亮底：折叠后没有可见叶子项，
 * 靠分组标题带选中底色指路。之前写死 `var(--ant-menu-item-selected-bg)`——该变量
 * 只在宿主开启 antd cssVar 时才存在（且挂在菜单根的作用域 class 上，不在 :root），
 * 宿主未开 cssVar / 换了前缀就直接解析为空，背景变透明（选中背景丢失）。
 * 改用 JSS 主题的 token.controlItemBgActive：即 antd Menu 的 itemSelectedBg 来源
 * （menu/style 里 `itemSelectedBg: controlItemBgActive`），任何主题/配置下都随主题
 * 解析为具体色值，不依赖 CSS 变量是否注入。
 */
export const useStyles: (data?: any) => Record<"menuBackgroundColor", string> = createUseStyles(({ token }) => ({
	menuBackgroundColor: {
		"& .ant-menu-submenu-selected .ant-menu-submenu-title": {
			backgroundColor: token.controlItemBgActive,
		},
	},
}));
