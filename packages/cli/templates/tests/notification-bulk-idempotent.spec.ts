// BDD：通知批量动作（全部已读 / 清空）迁到构造器 fromSelect().orIgnore() 后的行为。
//
// 背景（上游需求 #4，oj v0.1.128 闭环）：两处裸 `db.exec("INSERT OR IGNORE … SELECT")` 曾
// 在 MySQL 报 1064、PG 报语法错；上游补齐 sqlite 的 fromSelect + orIgnore 组合后，模板改用
// 同一段构造器代码三方言通用。本文件钉三件在构造器迁移后**最容易静默退化**的事：
//   ① 连跑两次不产生重复回执行——orIgnore 只幂等唯一键冲突，去重靠 0006 的唯一约束，
//      没有它 `INSERT OR IGNORE` 是空操作（历史 bug）；
//   ② 源 select 的列按位置对齐（id→broadcast_id，lit→user_id / 时间戳），且 tenant_id
//      由构造器注入（业务代码不写、也不能写进 cols）；
//   ③ 源 select 的租户收窄继承——只给当前租户的广播落回执，别家租户的广播不得串进来。

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { clearNotices, markAllRead, pushBroadcastNotice } from "../src/app/api/notification/_shared/notify";
import { installDb } from "./fixture";

const g = globalThis as any;
const UID = 7;
let dbo: ReturnType<typeof installDb>;

beforeAll(() => {
	dbo = installDb();
});

beforeEach(() => {
	dbo.exec("DELETE FROM notifications_broadcast_read");
	dbo.exec("DELETE FROM notifications_broadcast_hidden");
	dbo.exec("DELETE FROM notifications_broadcast");
	dbo.exec("DELETE FROM notifications");
	g.http = { tenantId: "default" };
});

describe("markAllRead / clearNotices：构造器幂等 INSERT … SELECT", () => {
	it("连跑两次不重复落，列按位置对齐，tenant_id 由构造器注入", async () => {
		await pushBroadcastNotice({ title: "b1", message: "m1" });
		await pushBroadcastNotice({ title: "b2", message: "m2" });
		const ids = (dbo.prepare("SELECT id FROM notifications_broadcast ORDER BY id").all() as Array<{ id: number }>).map(r => r.id);
		expect(ids).toHaveLength(2);

		await markAllRead(UID);
		await markAllRead(UID);
		const reads = dbo.prepare("SELECT tenant_id, broadcast_id, user_id, read_time FROM notifications_broadcast_read ORDER BY broadcast_id").all() as any[];
		expect(reads).toHaveLength(2);
		expect(reads.map(r => r.broadcast_id)).toEqual(ids);
		for (const r of reads) {
			expect(r.tenant_id).toBe("default");
			expect(r.user_id).toBe(UID);
			expect(String(r.read_time)).not.toBe("");
		}

		await clearNotices(UID);
		await clearNotices(UID);
		const hidden = dbo.prepare("SELECT tenant_id, broadcast_id, user_id, create_time FROM notifications_broadcast_hidden ORDER BY broadcast_id").all() as any[];
		expect(hidden).toHaveLength(2);
		expect(hidden.map(r => r.broadcast_id)).toEqual(ids);
		for (const r of hidden) {
			expect(r.tenant_id).toBe("default");
			expect(r.user_id).toBe(UID);
			expect(String(r.create_time)).not.toBe("");
		}
	});

	it("源 select 的租户收窄：只给当前租户的广播落回执", async () => {
		dbo.prepare("INSERT INTO notifications_broadcast (tenant_id, title, message, avatar, date, category, create_time) VALUES ('default','t1','m','','','notice','')").run();
		dbo.prepare("INSERT INTO notifications_broadcast (tenant_id, title, message, avatar, date, category, create_time) VALUES ('other','t2','m','','','notice','')").run();
		const mine = dbo.prepare("SELECT id FROM notifications_broadcast WHERE tenant_id = 'default'").get() as { id: number };

		await markAllRead(UID);
		const reads = dbo.prepare("SELECT tenant_id, broadcast_id FROM notifications_broadcast_read").all() as any[];
		expect(reads).toHaveLength(1);
		expect(reads[0]!.broadcast_id).toBe(mine.id);
		expect(reads[0]!.tenant_id).toBe("default");
	});

	it("user_id 属唯一键：不同用户各自落一份回执，lit 常量按调用绑定", async () => {
		await pushBroadcastNotice({ title: "b", message: "m" });
		await markAllRead(7);
		await markAllRead(8);
		await markAllRead(7); // 重复调用仍不增行
		const reads = dbo.prepare("SELECT user_id, count(*) AS n FROM notifications_broadcast_read GROUP BY user_id ORDER BY user_id").all() as any[];
		expect(reads).toEqual([{ user_id: 7, n: 1 }, { user_id: 8, n: 1 }]);
	});
});
