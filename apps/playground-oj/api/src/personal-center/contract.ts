import { defineApi, z } from "@oj-module/runtime/contract";

/**
 * personal-center 模块契约（uni-dev 形态，apiPrefix 字面等于 "/personal-center"，AC-D9）。
 * 头像/附件上传端点——前端经 ctx.register.uploadApi 接管 form-avatar-item 的 action/headers（见 P4）。
 */

/* 头像上传：实际为 multipart（由 antd Upload 直连 uploadProvider.action 发送，
 * 不经 JSON client），故此处不声明 body schema；data 为上传后返回的资源 URL。 */
export const upload = defineApi({
	apiPrefix: "/personal-center",
	route: "/upload",
	method: "POST",
	data: z.string(),
	description: "头像/附件上传，返回资源 URL",
});
