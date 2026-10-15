import { useTabKey } from "@oj-module/runtime";
import { act, render } from "@testing-library/react";
import { KeepAlive } from "keepalive-for-react";
import { useEffect } from "react";

import { MemoryRouter, Route, Routes, useLocation, useNavigate, useOutlet } from "react-router";

import { describe, expect, it } from "vitest";

/**
 * useTabKey 的 keepAlive 回归测试（0.1.21）。
 *
 * 陷阱：keepalive-for-react 把页面缓存在隐藏容器里，而 LocationContext 在 KeepAlive
 * 之上——切页签时缓存树随**激活页**位置重渲染，缓存页里的 useLocation() 返回别家页签
 * 的路径。拿它当 setTableTitle 的 key 会把本页标题写到激活页签上。
 * 本测试用真实 keepalive-for-react 复现该机制：含一个「实时 useLocation」对照组证明
 * harness 确实能捕到污染（防测试空转），再验证 useTabKey 不受影响。
 */

/** 每个页签写到的标题（tabKey -> title），跨导航累积 */
const writes = new Map<string, string>();

beforeEach(() => {
	writes.clear();
});

/** 镜像 runtime KeepAliveLayer：cacheKey = pathname + search（v0.1.20 口径） */
function KeepAliveLayer() {
	const { pathname, search } = useLocation();
	const outlet = useOutlet();
	return (
		<KeepAlive activeCacheKey={pathname + search} max={20}>
			{outlet}
		</KeepAlive>
	);
}

let navigate: ((to: string) => void) | undefined;
function Driver() {
	navigate = useNavigate();
	return null;
}

/** 正确形态：useTabKey（首渲染捕获，存活期稳定） */
function FixedDocPage({ name }: { name: string }) {
	const tabKey = useTabKey();
	useEffect(() => {
		writes.set(tabKey, name);
	}, [tabKey, name]);
	return <div>{name}</div>;
}

/** 对照组：实时 useLocation（修复前的错误形态），用于证明本 harness 能复现污染 */
function BuggyDocPage({ name }: { name: string }) {
	const tabKey = useLocation().pathname;
	useEffect(() => {
		writes.set(tabKey, name);
	}, [tabKey, name]);
	return <div>{name}</div>;
}

function PlainPage({ name }: { name: string }) {
	return <div>{name}</div>;
}

function renderShell(mode: "fixed" | "buggy", initial = "/space/1/doc/42") {
	const Doc = mode === "fixed" ? FixedDocPage : BuggyDocPage;
	return render(
		<MemoryRouter initialEntries={[initial]}>
			<Driver />
			<Routes>
				<Route element={<KeepAliveLayer />}>
					<Route path="/space/:id/doc/42" element={<Doc name="关于" />} />
					<Route path="/space/:id/doc/43" element={<Doc name="指南" />} />
					<Route path="/wiki/collections" element={<PlainPage name="收藏" />} />
				</Route>
			</Routes>
		</MemoryRouter>,
	);
}

describe("useTabKey（keepAlive 下页签标题不串台）", () => {
	it("对照组：实时 useLocation 形态确实污染别家页签（harness 有效性）", () => {
		renderShell("buggy");
		act(() => navigate?.("/wiki/collections"));
		// 缓存的「关于」页用激活位置当 key，把「关于」写到收藏页签上——即线上症状
		expect(writes.get("/wiki/collections")).toBe("关于");
	});

	it("useTabKey 形态：切走不污染别家页签，切回多文档页各写各的 key", () => {
		renderShell("fixed");
		expect(writes.get("/space/1/doc/42")).toBe("关于");

		act(() => navigate?.("/wiki/collections"));
		expect(writes.has("/wiki/collections")).toBe(false);
		expect(writes.get("/space/1/doc/42")).toBe("关于");

		act(() => navigate?.("/space/1/doc/43"));
		expect(writes.has("/wiki/collections")).toBe(false);
		expect(writes.get("/space/1/doc/42")).toBe("关于");
		expect(writes.get("/space/1/doc/43")).toBe("指南");
	});

	it("页签 key 口径：去掉尾部斜杠", () => {
		render(
			<MemoryRouter initialEntries={["/space/1/doc/42/"]}>
				<Routes>
					<Route element={<KeepAliveLayer />}>
						<Route path="/space/:id/doc/42" element={<FixedDocPage name="关于" />} />
					</Route>
				</Routes>
			</MemoryRouter>,
		);
		expect(writes.has("/space/1/doc/42/")).toBe(false);
		expect(writes.get("/space/1/doc/42")).toBe("关于");
	});
});
