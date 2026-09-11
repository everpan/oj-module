/** oj matchit 同款参数段：整段必须是 {name} 或 {*name}，不得混字面 */
const PARAM_SEGMENT = /^\{\*?[a-z_]\w*\}$/i;
function fail(route, reason) {
    throw new Error(`[契约] 端点定义非法（route: ${route}）：${reason}`);
}
function validateDefinition(def) {
    const { apiPrefix, route } = def;
    if (!apiPrefix?.startsWith("/")) {
        throw new Error(`[契约] apiPrefix 必须以 "/" 开头（收到: ${apiPrefix}）——如 "/order"；uni-dev 形态请与 oj 模块段名保持一致（AC-D9）。`);
    }
    if (!route?.startsWith("/"))
        fail(route, `route 必须以 "/" 开头（收到: ${route}），且一律相对 apiPrefix——不支持 oj 的根绝对写法（模块手册 D11 前缀收敛）。`);
    if (route.split("/").some(seg => seg === ".." || seg === "." || seg === "\\"))
        fail(route, "route 含路径穿越段（.././\\），请改为正常静态段。");
    for (const seg of route.split("/")) {
        if (seg.includes("{") && !PARAM_SEGMENT.test(seg))
            fail(route, `参数段 "${seg}" 混入字面量——matchit 约束：参数段必须整段为 {name} 或 {*name}，需要前缀/后缀字面时请拆成静态多段。`);
    }
    if (def.data && def.response === "raw")
        fail(route, "data schema 与 response:\"raw\" 互斥——raw 端点不解包信封，不需要 data schema。");
    if (def.response !== undefined && def.response !== "raw")
        fail(route, `response 仅支持 "raw"（收到: ${String(def.response)}）。`);
    // 评审 F9：方法面在定义期封顶，而不是延迟到 codegen 才炸
    if (def.method === "OPTIONS")
        fail(route, "OPTIONS 不在支持范围（ky/oj 均无对应方法）——预检请求由 fetch/CORS 层处理，契约不表达。");
    if (def.method === "HEAD" && def.data)
        fail(route, "HEAD 端点无响应体，不能声明 data schema——需要响应体请改用 GET。");
}
/**
 * defineApi 产物的品牌标记（Symbol.for 跨模块实例稳定）。
 * 非枚举属性——不影响 .route 等的可枚举性；codegen 据此可靠识别端点，
 * 不与契约文件里导出的普通 schema/常量混淆。
 */
export const API_DEF = Symbol.for("ojm.api.def");
/**
 * 旧品牌标记（`ram.api.def`）：**只读兼容**——存量工程若仍装着旧 runtime
 * 产物，其端点打的是旧符号；新 codegen 必须同时认（设计 §7 R3）。
 * `defineApi` 新写只发 `API_DEF`，此常量仅供 IR 识别。
 */
export const API_DEF_LEGACY = Symbol.for("ram.api.def");
/** 定义一个契约端点：定义期校验后原样返回（描述符 .route 等可枚举，供 codegen/mock 遍历） */
export function defineApi(def) {
    validateDefinition(def);
    Object.defineProperty(def, API_DEF, { value: true, enumerable: false });
    return def;
}
