// oj 导入别名（`#` 开头）的类型兜底。
//
// 背景：oj 的 `#x`（**本模块根**）/ `#/m/x`（**src 根**）别名是「引用方所在模块」
// 相对的，而 tsconfig 的 `paths` 只能做**静态全局映射**——无法表达模块相对解析。
// 因此 `paths["#*"]` 枚举了各模块目录，仅能命中**已存在**的文件；对尚未创建或不在
// 枚举范围内的别名（如 `#_shared/view`），编辑器会报 TS2307「Cannot find module」。
//
// 本文件是**非模块**（无顶层 import/export），其中的 `declare module` 才是真正的
// ambient 声明——放在模块化的 `global.d.ts` 里会被当作 module augmentation 而不生效。
// 通配 ambient 作为 `paths` 解析失败后的兜底：无法静态定位的 `#` 导入降级为 `any`
// 且不再报错；**已存在、能被 `paths` 命中的别名仍走其真实文件类型**（解析优先）。
//
// 运行时始终由 oj 的 loader（`module_loader.rs::resolve_alias`）解析，本文件只影响
// 编辑器 / tsc。业务项目若自定义了全局或别名，可仿此在源码根另建 `.d.ts`。
declare module "#*";
