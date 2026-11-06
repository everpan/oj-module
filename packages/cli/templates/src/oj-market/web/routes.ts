import type { ModuleContext } from "@oj-module/runtime";

import { createOjMarketClient } from "./__client";

/**
 * 市场编排面（/api/oj-market/*）client 接线：entry 的 onInit 里一行创建——
 * 登记契约前缀 /oj-market + 绑定 scoped request。页面/子应用经 web/api/client.ts
 * 的领域接口消费（内部委托本 __client 的静态函数）。
 */
export function onInit(ctx: ModuleContext): void {
	createOjMarketClient(ctx);
}
