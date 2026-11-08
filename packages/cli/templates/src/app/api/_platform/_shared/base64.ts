// 字节 → base64（纯查表，服务端 isolate 无 Buffer/btoa 全局）。
// upload/api.ts 与企微头像同步（login.ts::applyMemberDetail）共用的唯一实现，别各写一份。
export function bytesToBase64(bytes: Uint8Array): string {
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
