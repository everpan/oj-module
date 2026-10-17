// 过渡实现：上游 crypto.sha384 原语落地后替换（需求稿已提，见
// docs/prd/solution/202610161500-oj-bin-feature-requests-pr.md）。
// 纯 JS SHA-384（B-11 真机补面）：oj isolate 的 crypto 面（0.1.78 实测）只有
// sha256Hex/md5Hex/aesGcm/verifyEd25519，无 sha384 原语；而契约 C2-28 的 web.integrity
// 钉死 `sha384-<base64>`（ojm build 于 Node 侧写入），安装器必须同算法重算比对（R10
// fail-closed）——真机冒烟首轮死于 `crypto.sha384B64 is not a function`。实现取 SHA-512
// 核心（sha384 = 截断 48 字节 + 独立 IV），hi/lo 双 Uint32 字实现（BigInt 版逐块 80 轮在
// MB 级产物上不可接受）。K/IV 常量表不在代码里摊开：模块加载时由素数平方根/立方根小数
// 部分推导（FIPS 180-4 定义式，一次性 <1ms，逐字等于手抄表）。

/** 前 count 个素数（2 起）——K/IV 的种子，N=80 时最坏几百次试除，加载期一次性 */
function primes(count: number): bigint[] {
	const out: bigint[] = [];
	for (let n = 2n; out.length < count; n++) {
		let isPrime = true;
		for (const p of out) {
			if (p * p > n)
				break;
			if (n % p === 0n) {
				isPrime = false;
				break;
			}
		}
		if (isPrime)
			out.push(n);
	}
	return out;
}

/** floor((x << (64·root)) ** (1/root)) 的低 64 位：FIPS 180-4 常量 = 素数 root 次根小数部分前 64 位。二分整根（≤66 步），加载期一次性 */
function frac64(x: bigint, root: bigint): [number, number] {
	const shift = x << (64n * root);
	let lo = 0n;
	let hi = 16n << 64n; // 上界：素数 ≤ 409 ⇒ root 次根 = cbrt(p)·2^64 < 16·2^64
	while (lo < hi) {
		const mid = (lo + hi + 1n) >> 1n;
		if (mid ** root <= shift)
			lo = mid;
		else
			hi = mid - 1n;
	}
	const low64 = lo & ((1n << 64n) - 1n);
	return [Number(low64 >> 32n) >>> 0, Number(low64 & 0xFFFFFFFFn) >>> 0];
}

// K = 前 80 个素数的立方根小数部分前 64 位（FIPS 180-4 §4.2.3 定义式推导，逐字等于手抄表）。
const K: Array<[number, number]> = primes(80).map(p => frac64(p, 3n));
// sha384 IV（FIPS 180-4 §5.3.4 逐字）：8 × 64bit，hi/lo 对
const IV: Array<[number, number]> = [
	[0xCBBB9D5D, 0xC1059ED8],
	[0x629A292A, 0x367CD507],
	[0x9159015A, 0x3070DD17],
	[0x152FECD8, 0xF70E5939],
	[0x67332667, 0xFFC00B31],
	[0x8EB44A87, 0x68581511],
	[0xDB0C2E0D, 0x64F98FA7],
	[0x47B5481D, 0xBEFA4FA4],
];

const MASK = 0xFFFFFFFF;

/** rotr(x, n) 作用在 hi/lo 合成 64 位上（拆移位组合，无 BigInt 热路径） */
function rotrHi(hi: number, lo: number, n: number): number {
	if (n === 32)
		return hi;
	if (n < 32)
		return ((hi >>> n) | (lo << (32 - n))) & MASK;
	return ((lo >>> (n - 32)) | (hi << (64 - n))) & MASK;
}
function rotrLo(hi: number, lo: number, n: number): number {
	if (n === 32)
		return lo;
	if (n < 32)
		return ((lo >>> n) | (hi << (32 - n))) & MASK;
	return ((hi >>> (n - 32)) | (lo << (64 - n))) & MASK;
}

/**
 * 64 位加法（hi/lo 对，进位取模 2^32）。入参低位先 >>> 0 归一：上游 XOR/rotr 链会漏出
 * 负 int32（& MASK 不改符号位），进位判定 lo < alo 在负数输入下恒假 → 丢进位（真机向量首轮实测）
 */
function add64(a: [number, number], b: [number, number]): [number, number] {
	const alo = a[1] >>> 0;
	const blo = b[1] >>> 0;
	const lo = (alo + blo) >>> 0;
	const carry = lo < alo ? 1 : 0;
	return [(a[0] + b[0] + carry) & MASK, lo];
}

/** SHA-384 字节摘要（48 字节）；data = 任意长度字节序列 */
export function sha384Bytes(data: Uint8Array): Uint8Array {
	// 消息填充：0x80 + 0x00... + 128bit 长度（bit 数）
	const bitLenHi = Math.floor((data.length / 0x20000000)) >>> 0;
	const bitLenLo = (data.length << 3) >>> 0;
	const padded = (((data.length + 16) >> 7) + 1) << 7;
	const buf = new Uint8Array(padded);
	buf.set(data);
	buf[data.length] = 0x80;
	const view = new DataView(buf.buffer);
	view.setUint32(padded - 16, bitLenHi);
	view.setUint32(padded - 4, bitLenLo);

	const h: Array<[number, number]> = IV.map(x => [x[0], x[1]] as [number, number]);
	const w = Array.from({ length: 80 });
	for (let off = 0; off < padded; off += 128) {
		for (let t = 0; t < 16; t++) {
			w[t] = [view.getUint32(off + t * 8), view.getUint32(off + t * 8 + 4)];
		}
		for (let t = 16; t < 80; t++) {
			// σ0 = ROTR1 ^ ROTR8 ^ SHR7；σ1 = ROTR19 ^ ROTR61 ^ SHR6。SHR 低字必须从 hi 的低位
			// 补进 hi<<(32-n)（64 位逻辑右移跨字，非两次独立 32 位移位——差此项向量不过，差分实测）
			const a15 = w[t - 15];
			const a2 = w[t - 2];
			const s0h = rotrHi(a15[0], a15[1], 1) ^ rotrHi(a15[0], a15[1], 8) ^ (a15[0] >>> 7);
			const s0l = rotrLo(a15[0], a15[1], 1) ^ rotrLo(a15[0], a15[1], 8) ^ ((a15[1] >>> 7) | (a15[0] << 25));
			const s1h = rotrHi(a2[0], a2[1], 19) ^ rotrHi(a2[0], a2[1], 61) ^ (a2[0] >>> 6);
			const s1l = rotrLo(a2[0], a2[1], 19) ^ rotrLo(a2[0], a2[1], 61) ^ ((a2[1] >>> 6) | (a2[0] << 26));
			w[t] = add64(add64(add64(w[t - 16], [s0h, s0l]), w[t - 7]), [s1h, s1l]);
		}
		let [ah, al] = h[0];
		let [bh, bl] = h[1];
		let [ch, cl] = h[2];
		let [dh, dl] = h[3];
		let [eh, el] = h[4];
		let [fh, fl] = h[5];
		let [gh, gl] = h[6];
		let [hh, hl] = h[7];
		for (let t = 0; t < 80; t++) {
			// S1 = Σ6(e)，ch = (e&f)^(~e&g)，T1 = h + S1 + ch + K[t] + w[t]
			const s1h = rotrHi(eh, el, 14) ^ rotrHi(eh, el, 18) ^ rotrHi(eh, el, 41);
			const s1l = rotrLo(eh, el, 14) ^ rotrLo(eh, el, 18) ^ rotrLo(eh, el, 41);
			const chh = (eh & fh) ^ (~eh & gh) & MASK;
			const chl = (el & fl) ^ (~el & gl) & MASK;
			const t1 = add64(add64(add64(add64([hh, hl], [s1h, s1l]), [chh, chl]), K[t]), w[t]);
			// S0 = Σ0(a)，maj = (a&b)^(a&c)^(b&c)，T2 = S0 + maj
			const s0h = rotrHi(ah, al, 28) ^ rotrHi(ah, al, 34) ^ rotrHi(ah, al, 39);
			const s0l = rotrLo(ah, al, 28) ^ rotrLo(ah, al, 34) ^ rotrLo(ah, al, 39);
			const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
			const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
			const t2 = add64([s0h, s0l], [majh, majl]);
			hh = gh;
			hl = gl;
			gh = fh;
			gl = fl;
			fh = eh;
			fl = el;
			[eh, el] = add64([dh, dl], t1);
			dh = ch;
			dl = cl;
			ch = bh;
			cl = bl;
			bh = ah;
			bl = al;
			[ah, al] = add64(t1, t2);
		}
		h[0] = add64(h[0], [ah, al]);
		h[1] = add64(h[1], [bh, bl]);
		h[2] = add64(h[2], [ch, cl]);
		h[3] = add64(h[3], [dh, dl]);
		h[4] = add64(h[4], [eh, el]);
		h[5] = add64(h[5], [fh, fl]);
		h[6] = add64(h[6], [gh, gl]);
		h[7] = add64(h[7], [hh, hl]);
	}
	// 截断 48 字节 = 前 6 个字
	const out = new Uint8Array(48);
	const ov = new DataView(out.buffer);
	for (let i = 0; i < 6; i++) {
		ov.setUint32(i * 8, h[i][0]);
		ov.setUint32(i * 8 + 4, h[i][1]);
	}
	return out;
}

/** bytes → base64（btoa 双端可用：oj isolate 全局 atob/btoa，Node 18+ 同名全局） */
export function bytesToBase64(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) {
		bin += String.fromCharCode(b);
	}
	return btoa(bin);
}

/** C2-28/R10 完整 integrity 值：`sha384-<base64(digest)>` */
export function sha384B64(data: Uint8Array): string {
	return `sha384-${bytesToBase64(sha384Bytes(data))}`;
}
