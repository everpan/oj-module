// oj 导入别名（`#` 开头）的类型兜底。
//
// 背景：oj 的 `#x`（**本模块根**，本布局下即 `src/<name>/api`）/ `#/<模块名>/x`
// （**目标模块根**）是「引用方所在模块」相对的，而 tsconfig 的 `paths` 只能做**静态
// 全局映射**。`tsconfig.paths.json` 因此按模块枚举了 `"#/<模块名>/*"`，仅能命中
// **已存在**的文件；跨模块别名的模块名写错、或用了尚未创建的 `#_shared/view` 这类
// 模块内别名，编辑器会报 TS2307「Cannot find module」。
//
// 本文件是**非模块**（无顶层 import/export），其中的 `declare module` 才是真正的
// ambient 声明——放在模块化的 `global.d.ts` 里会被当作 module augmentation 而不生效。
// 通配 ambient 作为 `paths` 解析失败后的兜底：无法静态定位的 `#` 导入降级为 `any`
// 且不再报错；**已存在、能被 `paths` 命中的别名仍走其真实文件类型**（解析优先）。
//
// 运行时始终由 oj 的 loader（`module_loader.rs::resolve_alias`）解析，本文件只影响
// 编辑器 / tsc。模块名写错这类事故由 `oj build` 的 S008（别名无法解析）在构建期拦下，
// 不会拖到运行期。业务项目若自定义了全局或别名，可仿此在源码根另建 `.d.ts`。
declare module "#*";
