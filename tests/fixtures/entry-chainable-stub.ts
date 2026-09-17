// 从 `@oj-module/runtime` 取 defineModule（走 runtime 虚拟桩，不拉真实 runtime 源——
// 真实源含 `.svg?react` 之类 esbuild 解析不了的产物导入，见 page-error/logo 组件）
import { defineModule } from "@oj-module/runtime";
import { create } from "zustand";

/**
 * 测试夹具（回归）：**模块顶层**调用被桩化的裸依赖，且是**柯里化工厂**形态。
 *
 * 背景（真踩过，plane M2a A2）：裸导入桩此前是 `apply: () => undefined`——桩函数被调用
 * 得到 undefined，于是「先调一次取工厂、再调一次取实例」的柯里化 API 在第二次调用就抛
 * `(0, import_zustand.create)(...) is not a function`。zustand v5 正是此形态
 * （`create<T>()(initializer)`）且模块在最顶层求值 → `ojm dev/build` 读元数据即崩、
 * 整条 dev 链路起不来，而模块代码本身完全合法。
 *
 * 同类形态：`axios.create(...)`、`i18next.createInstance(...)`、`createTheme(...)`。
 * 桩只在元数据读取期运行，放宽为「可无限链式」只会把崩溃变成无害空转。
 *
 * 刻意用**真实存在**的 `zustand`（而非虚构说明符）：TS 能解析、且与线上触发场景同源。
 */
export const useStore = create<{ n: number }>()(() => ({ n: 0 }));

export default defineModule({
	name: "chainable-stub",
	description: "夹具：顶层柯里化裸依赖调用（桩可链式回归）",
	version: "0.0.0",
	routes: [],
});
