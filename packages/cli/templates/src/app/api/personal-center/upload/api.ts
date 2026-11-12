// POST /api/personal-center/upload —— 头像上传（multipart→base64，P4-3，D7/F4）。
// antd Upload 直连本端点（不经 JSON client），文件在 http.files[0]。
//
// 两条取字节路径（devkit 手册 §6 http.files，v0.1.38）：
//   · 小文件（≤ server.max_upload_bytes，默认 10MB）：字节照常在 handler 里，http.file(0)；
//   · 大文件（> max_upload）：服务端已流式直落 blob、字节不进 handler，此时
//     http.file(0) 会**报错**，必须改走 files[0].key + blob.get(key)。
// 头像通常远小于阈值，但别写成「只会一种」——换了上传组件/放开体积就会 500。
import { bytesToBase64 } from "#/_platform/_shared/base64";
import { isSelfTenant } from "#/_platform/_shared/service/infra/access";

const handler = {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		// 写入目标按 uid 定位 users 行：伪造 X-TENANT-ID 时该行在本租户不存在，
		// 不拦就会「更新 0 行却回 200」，还顺带在 blob 里留下垃圾文件
		if (!(await isSelfTenant())) {
			json.fail(403, "forbidden");
			return;
		}
		if (!http.files || http.files.length === 0) {
			json.fail(400, "no file");
			return;
		}
		try {
			const meta = http.files[0];
			// meta.key 非空 = 已被服务端流式落 blob（大文件），取字节只能走 blob
			const bytes = meta.key ? await blob.get(meta.key) : await http.file(0);
			const b64 = bytesToBase64(bytes);
			const dataUrl = `data:${meta.content_type || "application/octet-stream"};base64,${b64}`;
			await db.table("users").update({ avatar_base64: dataUrl }).where({ field: "id", op: "eq", value: Number(uid) }).run();
			// 大文件搬运/留档用 blob（v0.1.47）：搬走用 blob.move，别 get + put（字节进 V8）
			if (meta.key)
				await blob.del(meta.key);
			json.ok(dataUrl);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

// 出参（data payload）= 上传后返回的资源 URL（data: URL）。body 是 multipipart，
// 不在 .schema 白名单内（前端走 antd Upload 直连，不经 JSON client），故此处只声明出参。
// oj v0.1.72 起出参走平级 .response（与 .schema 同级，动词级优先于组级），
// .schema 只承载入参（params/query/body）。
handler.post.schema = {
	description: "上传头像（multipart/form-data，文件取 http.files[0]），返回 data: URL 字符串。浏览器端由 antd Upload 直连，不走 JSON client；MCP/tools-call 不能传 multipart，请勿用它上传文件。",
};

handler.post.response = {
	type: "string",
};

export default handler;
