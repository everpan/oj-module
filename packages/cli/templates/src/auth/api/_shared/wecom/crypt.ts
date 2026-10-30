// 企微代开发「指令回调」的验签与解密原语（Phase 1）。
//
// 为什么手写：oj isolate 的 crypto 面（0.1.110 实测，devkit global.d.ts）只有
// sha256Hex / md5Hex / aesGcm* / verifyEd25519 / verifyEd25519；企微指令回调钉死
// `msg_signature = sha1(sort(token,timestamp,nonce,Encrypt))` + `AES-256-CBC(PKCS#7)`，
// 两样都没有。处置与 _platform/api/_lifecycle/sha384.ts 一致：自实现 + 上游需求 R8
// （`crypto.sha1Hex` / `crypto.aesCbcDecrypt` 原语）。落地 R8 后本文件可直接删。
//
// 边界：只做**解密**（回包走明文 `echostr` / `success`），不做加密；输入按字节处理，
// 长度/填充非法一律抛错（不猜、不截断）——宁可事件处理失败留痕，不可解出半截明文。
// S 盒不手抄 512 字节常量表：按 FIPS 197 定义式（GF 乘法逆元 + 仿射变换）在加载期生成，
// 逆 S 盒由置换求逆（加载期一次性，<5ms）。

const BLOCK = 16;

/** GF(2^8) 乘法，域多项式 x^8+x^4+x^3+x+1（0x11B），AES 唯一乘法 */
function gmul(a: number, b: number): number {
	let p = 0;
	let x = a & 0xFF;
	let y = b & 0xFF;
	for (let i = 0; i < 8; i++) {
		if (y & 1)
			p ^= x;
		const hi = x & 0x80;
		x = (x << 1) & 0xFF;
		if (hi)
			x ^= 0x1B;
		y >>= 1;
	}
	return p;
}

/** 乘法逆元（0 的逆元定义为 0）：255 次试乘，加载期一次性 */
function ginv(a: number): number {
	if (a === 0)
		return 0;
	for (let x = 1; x < 256; x++) {
		if (gmul(a, x) === 1)
			return x;
	}
	throw new Error("aes: no inverse"); // 不可达（GF(2^8) 除 0 外皆可逆）
}

const rotl8 = (v: number, n: number): number => ((v << n) | (v >>> (8 - n))) & 0xFF;

// S 盒 = 逆元 ⊕ 循环移位 1/2/3/4 ⊕ 0x63（FIPS 197 §5.1.1）；逆 S 盒 = 该置换的逆
const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
for (let a = 0; a < 256; a++) {
	const inv = ginv(a);
	const s = inv ^ rotl8(inv, 1) ^ rotl8(inv, 2) ^ rotl8(inv, 3) ^ rotl8(inv, 4) ^ 0x63;
	SBOX[a] = s;
	INV_SBOX[s] = a;
}

const NK = 8; // AES-256：密钥 8 个 32bit 字
const NR = 14; // 轮数
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40]; // 只需前 NR/NK = 7 项

/** 密钥扩展（FIPS 197 §5.2）：返回 4*(NR+1) 个 32bit 字，字内 big-endian（b0 在高位） */
function expandKey(key: Uint8Array): Uint32Array {
	if (key.length !== 32)
		throw new Error(`aes: key must be 32 bytes, got ${key.length}`);
	const w = new Uint32Array(4 * (NR + 1));
	for (let i = 0; i < NK; i++)
		w[i] = ((key[4 * i]! << 24) | (key[4 * i + 1]! << 16) | (key[4 * i + 2]! << 8) | key[4 * i + 3]!) >>> 0;
	for (let i = NK; i < w.length; i++) {
		let t = w[i - 1]!;
		if (i % NK === 0) {
			// RotWord → SubWord → Rcon
			t = ((t << 8) | (t >>> 24)) >>> 0;
			t = ((SBOX[(t >>> 24) & 0xFF]! << 24) | (SBOX[(t >>> 16) & 0xFF]! << 16) | (SBOX[(t >>> 8) & 0xFF]! << 8) | SBOX[t & 0xFF]!) >>> 0;
			t = (t ^ (RCON[i / NK - 1]! << 24)) >>> 0;
		}
		else if (i % NK === 4) {
			// AES-256 特有：半轮 SubWord
			t = ((SBOX[(t >>> 24) & 0xFF]! << 24) | (SBOX[(t >>> 16) & 0xFF]! << 16) | (SBOX[(t >>> 8) & 0xFF]! << 8) | SBOX[t & 0xFF]!) >>> 0;
		}
		w[i] = (w[i - NK]! ^ t) >>> 0;
	}
	return w;
}

/** 状态按列优先：state[r + 4c] */
function addRoundKey(state: Uint8Array, w: Uint32Array, round: number): void {
	for (let c = 0; c < 4; c++) {
		const word = w[round * 4 + c]!;
		state[4 * c]! ^= (word >>> 24) & 0xFF;
		state[4 * c + 1]! ^= (word >>> 16) & 0xFF;
		state[4 * c + 2]! ^= (word >>> 8) & 0xFF;
		state[4 * c + 3]! ^= word & 0xFF;
	}
}

/** InvShiftRows：第 r 行循环右移 r 位 */
function invShiftRows(s: Uint8Array): void {
	const t = s.slice();
	for (let r = 1; r < 4; r++) {
		for (let c = 0; c < 4; c++)
			s[r + 4 * c] = t[r + 4 * ((c - r + 4) % 4)]!;
	}
}

function invSubBytes(s: Uint8Array): void {
	for (let i = 0; i < BLOCK; i++)
		s[i] = INV_SBOX[s[i]!]!;
}

/** InvMixColumns：列乘 [0e 0b 0d 09] 循环矩阵 */
function invMixColumns(s: Uint8Array): void {
	for (let c = 0; c < 4; c++) {
		const [a0, a1, a2, a3] = [s[4 * c]!, s[4 * c + 1]!, s[4 * c + 2]!, s[4 * c + 3]!];
		s[4 * c] = gmul(a0, 0x0E) ^ gmul(a1, 0x0B) ^ gmul(a2, 0x0D) ^ gmul(a3, 0x09);
		s[4 * c + 1] = gmul(a0, 0x09) ^ gmul(a1, 0x0E) ^ gmul(a2, 0x0B) ^ gmul(a3, 0x0D);
		s[4 * c + 2] = gmul(a0, 0x0D) ^ gmul(a1, 0x09) ^ gmul(a2, 0x0E) ^ gmul(a3, 0x0B);
		s[4 * c + 3] = gmul(a0, 0x0B) ^ gmul(a1, 0x0D) ^ gmul(a2, 0x09) ^ gmul(a3, 0x0E);
	}
}

/** 单块解密（等价逆密码） */
function decryptBlock(input: Uint8Array, w: Uint32Array, out: Uint8Array): void {
	const s = input.slice();
	addRoundKey(s, w, NR);
	for (let round = NR - 1; round >= 1; round--) {
		invShiftRows(s);
		invSubBytes(s);
		addRoundKey(s, w, round);
		invMixColumns(s);
	}
	invShiftRows(s);
	invSubBytes(s);
	addRoundKey(s, w, 0);
	out.set(s);
}

/** AES-256-CBC 解密（不做填充剥离） */
export function aes256CbcDecrypt(cipher: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
	if (iv.length !== BLOCK)
		throw new Error(`aes: iv must be 16 bytes, got ${iv.length}`);
	if (cipher.length === 0 || cipher.length % BLOCK !== 0)
		throw new Error(`aes: ciphertext length must be a positive multiple of 16, got ${cipher.length}`);
	const w = expandKey(key);
	const out = new Uint8Array(cipher.length);
	const block = new Uint8Array(BLOCK);
	let prev = iv.slice();
	for (let off = 0; off < cipher.length; off += BLOCK) {
		decryptBlock(cipher.subarray(off, off + BLOCK), w, block);
		for (let i = 0; i < BLOCK; i++) {
			out[off + i] = block[i]! ^ prev[i]!;
		}
		prev = cipher.subarray(off, off + BLOCK).slice();
	}
	return out;
}

/** PKCS#7 去填充（1..16 字节，逐字节校验；非法抛错） */
export function pkcs7Unpad(data: Uint8Array): Uint8Array {
	if (data.length === 0 || data.length % BLOCK !== 0)
		throw new Error("pkcs7: bad length");
	const pad = data[data.length - 1]!;
	if (pad < 1 || pad > BLOCK || pad > data.length)
		throw new Error("pkcs7: bad padding");
	for (let i = data.length - pad; i < data.length; i++) {
		if (data[i] !== pad)
			throw new Error("pkcs7: bad padding");
	}
	return data.subarray(0, data.length - pad);
}

/** SHA-1（FIPS 180-4），返回 20 字节 */
export function sha1(data: Uint8Array): Uint8Array {
	const len = data.length;
	const withPad = new Uint8Array((((len + 8) >> 6) + 1) * 64);
	withPad.set(data);
	withPad[len] = 0x80;
	const bits = len * 8;
	// 长度域 64bit big-endian：低 32 位足够（>512MB 的输入本就不该进 isolate）
	const dv = new DataView(withPad.buffer);
	dv.setUint32(withPad.length - 8, Math.floor(bits / 0x100000000));
	dv.setUint32(withPad.length - 4, bits >>> 0);

	let h0 = 0x67452301;
	let h1 = 0xEFCDAB89;
	let h2 = 0x98BADCFE;
	let h3 = 0x10325476;
	let h4 = 0xC3D2E1F0;
	const w = new Uint32Array(80);

	for (let off = 0; off < withPad.length; off += 64) {
		for (let i = 0; i < 16; i++)
			w[i] = dv.getUint32(off + i * 4);
		for (let i = 16; i < 80; i++) {
			const v = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
			w[i] = ((v << 1) | (v >>> 31)) >>> 0;
		}
		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;
		for (let i = 0; i < 80; i++) {
			let f: number;
			let k: number;
			if (i < 20) {
				f = (b & c) | (~b & d);
				k = 0x5A827999;
			}
			else if (i < 40) {
				f = b ^ c ^ d;
				k = 0x6ED9EBA1;
			}
			else if (i < 60) {
				f = (b & c) | (b & d) | (c & d);
				k = 0x8F1BBCDC;
			}
			else {
				f = b ^ c ^ d;
				k = 0xCA62C1D6;
			}
			const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0;
			e = d;
			d = c;
			c = ((b << 30) | (b >>> 2)) >>> 0;
			b = a;
			a = temp;
		}
		h0 = (h0 + a) >>> 0;
		h1 = (h1 + b) >>> 0;
		h2 = (h2 + c) >>> 0;
		h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0;
	}

	const out = new Uint8Array(20);
	const odv = new DataView(out.buffer);
	odv.setUint32(0, h0);
	odv.setUint32(4, h1);
	odv.setUint32(8, h2);
	odv.setUint32(12, h3);
	odv.setUint32(16, h4);
	return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Bytes(s: string): Uint8Array {
	return encoder.encode(s);
}

export function bytesToUtf8(b: Uint8Array): string {
	return decoder.decode(b);
}

export function bytesToHex(b: Uint8Array): string {
	let out = "";
	for (const x of b)
		out += x.toString(16).padStart(2, "0");
	return out;
}

/** 标准 base64 解码（oj v0.1.30 起有全局 atob；非法输入由 atob 抛错） */
export function b64ToBytes(s: string): Uint8Array {
	const bin = atob(s.replace(/\s+/g, ""));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++)
		out[i] = bin.charCodeAt(i);
	return out;
}

export function bytesToB64(b: Uint8Array): string {
	let bin = "";
	for (const x of b)
		bin += String.fromCharCode(x);
	return btoa(bin);
}

export function sha1Hex(data: string | Uint8Array): string {
	return bytesToHex(sha1(typeof data === "string" ? utf8Bytes(data) : data));
}

/**
 * 企微签名（明文 `signature` 与密文 `msg_signature` 同算法）：
 * 参数按字典序排序后拼接、sha1 取十六进制。
 */
export function wecomSignature(...parts: string[]): string {
	return sha1Hex(parts.slice().sort().join(""));
}

/**
 * 解出企微消息明文（`<xml>…</xml>` 或裸 `echostr`）。
 *
 * 明文结构（企微 §消息加解密）：`random(16B) | msg_len(4B, big-endian) | msg | receiveid`。
 * `receiveid` 对第三方平台/代开发模版是 **suite_id**；不一致即拒（错钥/错套件混用必须 fail-closed，
 * 否则不同套件的回调会互相污染）。43 字符 EncodingAESKey 末尾补 "=" 才是 44 字符 base64（32 字节）。
 */
export function unwrapWecomMessage(encryptedB64: string, encodingAesKey: string, expectedReceiver: string): string {
	const key = b64ToBytes(`${encodingAesKey}=`);
	if (key.length !== 32)
		throw new Error(`wecom: EncodingAESKey must decode to 32 bytes, got ${key.length}`);
	const plain = pkcs7Unpad(aes256CbcDecrypt(b64ToBytes(encryptedB64), key, key.subarray(0, BLOCK)));
	if (plain.length < 20)
		throw new Error("wecom: plaintext too short");
	const msgLen = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(16);
	if (20 + msgLen > plain.length)
		throw new Error("wecom: msg length out of range");
	const msg = bytesToUtf8(plain.subarray(20, 20 + msgLen));
	const receiver = bytesToUtf8(plain.subarray(20 + msgLen));
	if (receiver !== expectedReceiver)
		throw new Error(`wecom: receiver mismatch (got ${receiver === "" ? "<empty>" : "other"}, expected suite)`);
	return msg;
}
