import type { TreeDataNode } from "antd";

/**
 * 部门平表 → 树 / 子孙闭包。两处消费：部门管理页自己画树、用户页按部门（含子部门）筛选。
 * 只依赖 `id`/`parentId` 两个字段，所以既能吃 `systemDepartmentsGet` 的行，也能吃别的部门投影。
 */
export interface DeptLike {
	id: number
	parentId: number | null
}

/**
 * 组装 antd 树数据。后端下发平表（响应契约不支持递归 schema），树在这里拼。
 *
 * 两条脏数据防线（外部源可见范围裁剪的必然产物，不是 bug）：
 *   · emitted：每个节点只挂一次——成环时不会无限递归，环上未挂到的节点补挂到根；
 *   · depth：兜底，防御性上限，正常数据远达不到。
 */
export function buildTreeData<T extends DeptLike>(rows: T[], titleOf: (d: T) => React.ReactNode): TreeDataNode[] {
	const byId = new Map(rows.map(d => [d.id, d]));
	const childIds = new Map<number, number[]>();
	for (const d of rows) {
		if (d.parentId != null && byId.has(d.parentId))
			(childIds.get(d.parentId) ?? childIds.set(d.parentId, []).get(d.parentId)!).push(d.id);
	}
	const emitted = new Set<number>();
	const build = (d: T, depth: number): TreeDataNode | null => {
		if (emitted.has(d.id) || depth > 32)
			return null;
		emitted.add(d.id);
		return {
			key: d.id,
			title: titleOf(d),
			children: (childIds.get(d.id) ?? [])
				.map(id => build(byId.get(id)!, depth + 1))
				.filter((n): n is TreeDataNode => n !== null),
		};
	};
	const roots = rows.filter(d => d.parentId == null || !byId.has(d.parentId)).map(d => build(d, 0));
	// 环上节点：父存在但永远轮不到挂（父在环里）→ 补挂到根，保证一个不丢
	for (const d of rows) {
		if (!emitted.has(d.id))
			roots.push(build(d, 0));
	}
	return roots.filter((n): n is TreeDataNode => n !== null);
}

/**
 * 从 `roots` 出发向下取「自己 + 全部子孙」的 id 闭包。
 *
 * 两处用途：部门管理页挡「把父部门挂到自己孙部门下」（后端判环 400）；用户页筛部门时
 * 把子部门的人一并算进来。成环安全——每个节点最多进一次集合，循环必然终止。
 */
export function subtreeIds<T extends DeptLike>(rows: T[], roots: Iterable<number>): Set<number> {
	const ids = new Set<number>(roots);
	for (let grew = true; grew;) {
		grew = false;
		for (const d of rows) {
			if (d.parentId != null && ids.has(d.parentId) && !ids.has(d.id)) {
				ids.add(d.id);
				grew = true;
			}
		}
	}
	return ids;
}
