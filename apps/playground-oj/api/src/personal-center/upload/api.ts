// POST /api/personal-center/upload —— 头像上传（multipart→base64，P4-3，D7/F4）。
// antd Upload 直连本端点（不经 JSON client），文件在 http.files[0]。
//
// 两条取字节路径（devkit 手册 §6 http.files，v0.1.38）：
//   · 小文件（≤ server.max_upload_bytes，默认 10MB）：字节照常在 handler 里，http.file(0)；
//   · 大文件（> max_upload）：服务端已流式直落 blob、字节不进 handler，此时
//     http.file(0) 会**报错**，必须改走 files[0].key + blob.get(key)。
function toBase64(bytes: Uint8Array): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = bytes[i + 1];
		const b2 = bytes[i + 2];
		out += chars[b0 >> 2];
		out += chars[((b0 & 3) << 4) | (b1 !== undefined ? b1 >> 4 : 0)];
		out += b1 !== undefined
			? chars[((b1 & 15) << 2) | (b2 !== undefined ? b2 >> 6 : 0)]
			: "=";
		out += b2 !== undefined ? chars[b2 & 63] : "=";
	}
	return out;
}

export default {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
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
			const b64 = toBase64(bytes);
			const dataUrl = `data:${meta.content_type || "application/octet-stream"};base64,${b64}`;
			await db.exec("UPDATE users SET avatar_base64 = ? WHERE id = ?", [dataUrl, Number(uid)]);
			if (meta.key)
				await blob.del(meta.key);
			json.ok(dataUrl);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
