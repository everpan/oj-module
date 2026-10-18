/** gen-signed-fixtures.mjs 的类型声明（.mjs 无内联类型，供两端 TS 测试 import） */
export declare const FIXTURE_NAME: string;
export declare const FIXTURE_VERSION: string;
export declare const CANON: string;
export declare const TRUSTED_KEY: { key_id: string, public_key_hex: string };
export declare const UNKNOWN_KEY: { key_id: string, public_key_hex: string };
export declare function canonicalString(name: string, version: string, sha256: string): string;
export declare function fingerprintOf(publicKeyHex: string): string;
export declare function signCanonicalB64(privateKey: unknown, canonical: string): string;
export declare function verifyCanonicalB64(publicKeyHex: string, canonical: string, valueB64: string): boolean;
export declare function generate(outDir?: string): {
	sha256: string
	canonical: string
	tgzPath: string
	paths: { tgz: string, good: string, bad: string, unknown: string }
	sig: {
		good: { alg: string, key_id: string, public_key: string, value: string, canon: string }
		bad: { alg: string, key_id: string, public_key: string, value: string, canon: string }
		unknown: { alg: string, key_id: string, public_key: string, value: string, canon: string }
	}
};
