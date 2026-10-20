import { resetAdminFixture } from "./enter-template-app";

/** templates e2e 前置：admin 口令/must_change/限流归一（幂等，详见 enter-template-app.ts） */
export default function globalSetup(): void {
	resetAdminFixture();
}
