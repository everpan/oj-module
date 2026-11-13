import { restoreCanonicalOrigin } from "./config-origin";

/** templates e2e 收尾：把 globalSetup 临时解注的 canonical_origin 还原回模板默认注释态 */
export default function globalTeardown(): void {
	restoreCanonicalOrigin();
}
