/**
 * 菜单项目类型
 */
export interface MenuItemType {
	/**
	 * 菜单路径,item 的唯一标志
	 */
	key: string
	/**
	 * 菜单项标题
	 */
	label: React.ReactNode
	/**
	 * 子菜单的菜单项
	 */
	children?: MenuItemType[]
	/**
	 * 菜单图标
	 */
	icon?: React.ReactNode
	/**
	 * 是否禁用菜单
	 * @default false
	 */
	disabled?: boolean
	/**
	 * 所属模块名（0.2.16 R1，module-loader 注入）；归组据此甄别方案路由。
	 * 框架/后端路由无此字段。
	 */
	module?: string
	/**
	 * 方案路由分类（0.2.16 R2，作者声明于 handle）：main=常规组、admin=管理组、
	 * hidden=不进菜单。归组与隐藏判定读此字段。
	 */
	category?: "main" | "admin" | "hidden"
	/**
	 * 菜单排序（0.2.16 R2，作者声明于 handle）；归组内子项按此升序。
	 */
	order?: number
}
