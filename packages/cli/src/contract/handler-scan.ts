import type { ApiModuleRoot } from "../layout";
import type { IrEndpoint } from "./ir";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";

/**
 * oj handler 文件的 AST 扫描（scan 职责独立成模块，供 check 对账与 emit-stub
 * 已实现判定共用——check → run/emit-stub 存在反向依赖，扫描器放哪边都会循环）。
 *
 * 扫描口径与 oj v0.1.64 内省同规则：default 导出对象的动词键 = 端点；非动词键 +
 * 对象值 = 嵌套组（组名 = 路径段，字符串字面量键与标识符键同等）；语句起始的
 * `.route = "..."` 为路由覆写（绝对 / 开头挂 base 根下，否则相对本层前缀）。
 */

/**
 * oj 方法名 → HTTP 动词（emit-stub 的反向映射）。
 * 注意**不含 options**：契约运行时故意不表达 OPTIONS（预检请求由 fetch/CORS 层处理，
 * 见 runtime/contract 的方法白名单）——oj 树里的 options handler 因此永不进对账表
 * （不会被误报「未登记」）；routes.js 的 options 行经 parseRoutesJs 的
 * 大写回落归一，同样不误报 drift。
 */
export const VERB_OF: Record<string, IrEndpoint["method"]> = {
	get: "GET",
	post: "POST",
	put: "PUT",
	del: "DELETE",
	patch: "PATCH",
	head: "HEAD",
};

/** oj v0.1.64 嵌套上限（与 oj 内省一致）；超出即 oj 启动报错，checker 不深追 */
const MAX_GROUP_DEPTH = 4;

export interface HandlerRow {
	/** HTTP 动词 */
	method: IrEndpoint["method"]
	/** 目录镜像相对 api/src 的路径段（含模块段），如 "order/item" */
	dir: string
	/** 语句起始 `.route = "..."` 字面量（无则目录镜像直达） */
	tail?: string
	/** v0.1.64：点分 handler 链（"cccc.get"；顶层动词即方法名） */
	chain: string
	/** v0.1.64：组前缀解析后的有效路由全路径（base 相对、无前导 /；绝对 .route 即其自身） */
	full: string
	filePath: string
}

/** `a` / `a.b` 形式的属性访问 → 点分名；其余（调用/元素访问）→ undefined */
function dottedNameOf(node: ts.Expression): string | undefined {
	if (ts.isIdentifier(node))
		return node.text;
	if (ts.isPropertyAccessExpression(node)) {
		const base = dottedNameOf(node.expression);
		return base ? `${base}.${node.name.text}` : undefined;
	}
	return undefined;
}

/**
 * 语句起始的 `<路径>.route = "字面量"`（路径可为点分：`cccc.post.route`，运行时即
 * `cccc.post` 函数对象的 `.route`——与 oj 内省读 `fn.route` 同源）。空串视同未挂
 * （oj 口径）。oj build 只认顶层标准赋值，这里同口径且放宽到点分左值。
 */
function collectRouteDecls(sf: ts.SourceFile): Map<string, string> {
	const routes = new Map<string, string>();
	for (const stmt of sf.statements) {
		if (!ts.isExpressionStatement(stmt) || !ts.isBinaryExpression(stmt.expression))
			continue;
		const expr = stmt.expression;
		if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
			continue;
		if (!ts.isPropertyAccessExpression(expr.left) || expr.left.name.text !== "route")
			continue;
		if (!ts.isStringLiteral(expr.right) || expr.right.text === "")
			continue;
		const path = dottedNameOf(expr.left.expression);
		if (path)
			routes.set(path, expr.right.text);
	}
	return routes;
}

/** 顶层 `const x = { ... }` 对象字面量表：嵌套组经标识符引用时的解析依据 */
function collectObjectDecls(sf: ts.SourceFile): Map<string, ts.ObjectLiteralExpression> {
	const decls = new Map<string, ts.ObjectLiteralExpression>();
	for (const stmt of sf.statements) {
		if (!ts.isVariableStatement(stmt))
			continue;
		for (const decl of stmt.declarationList.declarations) {
			if (ts.isIdentifier(decl.name) && decl.initializer && ts.isObjectLiteralExpression(decl.initializer))
				decls.set(decl.name.text, decl.initializer);
		}
	}
	return decls;
}

/** 顶层 `const x = createXxx(env)` 调用声明表：工厂形态经标识符引用（`export default x`）时的解析依据 */
function collectCallDecls(sf: ts.SourceFile): Map<string, ts.CallExpression> {
	const decls = new Map<string, ts.CallExpression>();
	for (const stmt of sf.statements) {
		if (!ts.isVariableStatement(stmt))
			continue;
		for (const decl of stmt.declarationList.declarations) {
			if (ts.isIdentifier(decl.name) && decl.initializer && ts.isCallExpression(decl.initializer))
				decls.set(decl.name.text, decl.initializer);
		}
	}
	return decls;
}

/** verb 键 → 实现函数名（供 `.route` 语句按函数名查找；内联写法回落键名） */
function implNameOf(prop: ts.ObjectLiteralElementLike): string | undefined {
	if (ts.isShorthandPropertyAssignment(prop))
		return prop.name.text;
	if (ts.isMethodDeclaration(prop) && prop.name)
		return prop.name.getText();
	if (ts.isPropertyAssignment(prop)) {
		if (ts.isIdentifier(prop.name) && ts.isIdentifier(prop.initializer))
			return prop.initializer.text;
		if (prop.name)
			return prop.name.getText();
	}
	return undefined;
}

/** 非 verb 键 → 子组对象字面量（内联或经标识符解析）；函数/数组/基元 → undefined */
function groupValueOf(prop: ts.ObjectLiteralElementLike, decls: Map<string, ts.ObjectLiteralExpression>): ts.ObjectLiteralExpression | undefined {
	if (ts.isPropertyAssignment(prop)) {
		if (ts.isObjectLiteralExpression(prop.initializer))
			return prop.initializer;
		if (ts.isIdentifier(prop.initializer))
			return decls.get(prop.initializer.text);
		return undefined;
	}
	if (ts.isShorthandPropertyAssignment(prop))
		return decls.get(prop.name.text);
	return undefined;
}

/** default 导出对象：内联字面量或标识符（`export default api`） */
function defaultExportObject(sf: ts.SourceFile, decls: Map<string, ts.ObjectLiteralExpression>): ts.ObjectLiteralExpression | undefined {
	for (const stmt of sf.statements) {
		if (!ts.isExportAssignment(stmt) || stmt.isExportEquals)
			continue;
		if (ts.isObjectLiteralExpression(stmt.expression))
			return stmt.expression;
		if (ts.isIdentifier(stmt.expression))
			return decls.get(stmt.expression.text);
	}
	return undefined;
}

/**
 * 工厂形态（P2-14 裁决：修 handler-scan 认 CallExpression——`export default createXxxApi(env)`
 * 是调用表达式，此前扫描器不认，route-unregistered 守卫对 market/solutions 全族失效）：
 * 解析同文件同名函数声明体内 return 的对象字面量（运行时 oj 内省执行工厂拿到该对象，静态
 * 扫描镜像此语义）。支持多个 return；对象内标识符引用仍解析文件级顶层 const。
 * 补全（P2-14 形态遗漏）：`export default createXxxApi(marketEnv())` 中 `call.expression`
 * 是**带实参的调用表达式**，函数名落在 `call.expression.expression`（createXxxApi）；
 * 旧逻辑直接 dottedNameOf(call.expression) 对 CallExpression 返回 undefined → 扫成 0 路由，
 * 致使 ojm api --check 把 market 全族端点判为「未实现 / stub 缺失」。此处穿透一层取被调函数名。
 */
function factoryReturnObjects(sf: ts.SourceFile, call: ts.CallExpression): ts.ObjectLiteralExpression[] {
	// `export default createXxxApi(marketEnv())`：`call.expression` 为带实参的调用表达式，
	// 函数名在其 `.expression`；`export default obj.createXxxApi(marketEnv())` 同样穿透。
	const target = ts.isCallExpression(call.expression) ? call.expression.expression : call.expression;
	const callee = dottedNameOf(target);
	if (callee === undefined)
		return [];
	for (const stmt of sf.statements) {
		if (!ts.isFunctionDeclaration(stmt) || stmt.name?.text !== callee || stmt.body === undefined)
			continue;
		const out: ts.ObjectLiteralExpression[] = [];
		for (const st of stmt.body.statements) {
			if (ts.isReturnStatement(st) && st.expression !== undefined && ts.isObjectLiteralExpression(st.expression))
				out.push(st.expression);
		}
		return out;
	}
	return [];
}

/** 相对路由按层前缀解析（绝对 `/` 开头即根级）；与 oj 内省 resolve 同规则 */
function resolveRoute(own: string, prefix: string): string {
	return own.startsWith("/") ? own : (prefix ? `${prefix}/${own}` : own);
}

/** 有效路由全路径（base 相对、无前导 /）：绝对 .route 取其自身，否则目录镜像 + 相对尾 */
function fullPathOf(dir: string, tail: string | undefined): string {
	if (tail?.startsWith("/"))
		return tail.replace(/^\//, "");
	return [dir, tail].filter(Boolean).join("/");
}

/** 对账键（方法 + 全路径） */
export function pathKey(method: string, path: string): string {
	return `${method} ${path}`;
}

/**
 * handler 的有效 wire 全路径（带前导 /）：绝对 `.route` 即其自身；相对尾巴 = `/` + full。
 * 用于与契约 contractAbs（wirePrefix + route）对齐比对。
 */
export function handlerAbs(h: HandlerRow): string {
	return h.tail?.startsWith("/") ? h.tail : `/${h.full}`;
}

/**
 * `apiDir` 是**模块的 api 侧目录**（module-root → `src/<name>/api`，历史 → `api/src/<name>`），
 * `moduleName` 补进路由镜像的首段。两个参数而不是「扫描根 + 相对路径」，是因为 module-root
 * 布局在扫描根与 handler 目录之间多一层 `api`，而它不属于路由（见 layout.apiModuleRoots）。
 */
export function scanHandlerFile(filePath: string, apiDir: string, moduleName = ""): HandlerRow[] {
	const text = readFileSync(filePath, "utf8");
	const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const routes = collectRouteDecls(sf);
	const decls = collectObjectDecls(sf);
	const callDecls = collectCallDecls(sf);
	const inner = relative(apiDir, dirname(filePath)).split(sep).filter(Boolean).join("/");
	const relDir = [moduleName, inner].filter(Boolean).join("/");
	const rows: HandlerRow[] = [];
	const seen = new Set<ts.Node>();

	const walk = (obj: ts.ObjectLiteralExpression, chainPrefix: string, routePrefix: string, depth: number): void => {
		if (depth > MAX_GROUP_DEPTH || seen.has(obj))
			return;
		seen.add(obj);
		for (const prop of obj.properties) {
			// oj v0.1.64：组名可以是连字符等非标识符（"audit-log"），字符串字面量键与
			// 标识符键同等解析。保留限制：元素访问式元数据（api["x-y"].route = ...）
			// 仍不支持——reshape 授权形态为字符串字面量键 + 组内函数挂 .route。
			const name = (prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)))
				? prop.name.text
				: undefined;
			if (!name)
				continue;
			const chain = chainPrefix ? `${chainPrefix}.${name}` : name;
			if (VERB_OF[name]) {
				const fnName = implNameOf(prop) ?? name;
				const own = routes.get(chain) ?? routes.get(fnName);
				// 无自身 .route → 继承本层前缀（根层即目录镜像）；与 oj 内省同规则
				const tail = own === undefined
					? (routePrefix || undefined)
					: resolveRoute(own, routePrefix);
				rows.push({
					method: VERB_OF[name],
					dir: relDir,
					tail,
					chain,
					full: fullPathOf(relDir, tail),
					filePath,
				});
			}
			else {
				const child = groupValueOf(prop, decls);
				if (!child)
					continue; // 函数/数组/基元：oj 红线，checker 不当路由
				const own = routes.get(chain);
				const childPrefix = own === undefined
					? (routePrefix ? `${routePrefix}/${name}` : name)
					: resolveRoute(own, routePrefix);
				walk(child, chain, childPrefix, depth + 1);
			}
		}
		seen.delete(obj);
	};

	const root = defaultExportObject(sf, decls);
	if (root) {
		// 文件层 .route：default 导出为标识符时，该标识符的 .route 语句即整文件默认前缀
		let filePrefix = "";
		for (const stmt of sf.statements) {
			if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isIdentifier(stmt.expression)) {
				const own = routes.get(stmt.expression.text);
				if (own !== undefined)
					filePrefix = resolveRoute(own, "");
			}
		}
		walk(root, "", filePrefix, 1);
	}
	else {
		// 工厂形态（P2-14 + 补全）：export default 后接
		//  - CallExpression 直调：createXxx(env) / createXxx(marketEnv())
		//  - Identifier 引用：const api = createXxx(env); export default api
		// 组前缀从目录镜像起算（同内联字面量形态）。
		for (const stmt of sf.statements) {
			if (!ts.isExportAssignment(stmt) || stmt.isExportEquals)
				continue;
			const expr = stmt.expression;
			const callExpr = ts.isCallExpression(expr)
				? expr
				: (ts.isIdentifier(expr) ? callDecls.get(expr.text) : undefined);
			if (callExpr) {
				for (const obj of factoryReturnObjects(sf, callExpr))
					walk(obj, "", "", 1);
			}
		}
	}
	return rows;
}

/** 递归收全部 api.ts / api.js（目录形态与模块根单文件同扫） */
export function walkApiFiles(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir))
		return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory())
			walkApiFiles(p, out);
		else if (entry.name === "api.ts" || entry.name === "api.js")
			out.push(p);
	}
	return out;
}

/**
 * 已实现路由键集合（`"METHOD /abs/path"`，含绝对 .route 形态）。
 * emit-stub 据此跳过「已在别处（模块根嵌套组 / 其他文件）实现」的端点——否则 DDD
 * reshape 后镜像 stub 与真实 handler 双写同路由，oj 路由表出现重复注册。
 */
export function implementedRouteKeys(roots: readonly ApiModuleRoot[]): Set<string> {
	const keys = new Set<string>();
	for (const root of roots) {
		for (const f of walkApiFiles(root.dir)) {
			const text = readFileSync(f, "utf8");
			// stub 镜像文件不算实现——它们覆盖的路由需照常报「stub 缺失/待更新」
			if (/^\/\/ (?:ojm|ram)-api:stub /.test(text))
				continue;
			for (const row of scanHandlerFile(f, root.dir, root.name))
				keys.add(pathKey(row.method, handlerAbs(row)));
		}
	}
	return keys;
}
