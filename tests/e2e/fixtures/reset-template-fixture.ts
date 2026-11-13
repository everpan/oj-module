import { injectCanonicalOrigin } from "./config-origin";
import { resetAdminFixture } from "./enter-template-app";

/**
 * templates e2e 前置：admin 口令/must_change/限流归一（幂等，详见 enter-template-app.ts）；
 * 并临时解注 canonical_origin，使 MCP 服务页在 e2e 里能到 mounted（跑完由 globalTeardown 还原）
 */
export default function globalSetup(): void {
	resetAdminFixture();
	injectCanonicalOrigin();
}
