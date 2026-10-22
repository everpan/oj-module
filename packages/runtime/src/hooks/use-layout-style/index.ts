import type { CSSProperties } from "react";
import type { VisibleDomRect } from "#src/utils/dom";

import { useDebounceFn } from "ahooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCssVar } from "#src/hooks/use-css-var";
import {
	CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT,
	CSS_VARIABLE_LAYOUT_CONTENT_WIDTH,
	CSS_VARIABLE_LAYOUT_FOOTER_HEIGHT,
	CSS_VARIABLE_LAYOUT_HEADER_HEIGHT,
} from "#src/layout/constants";

import { getElementVisibleRect } from "#src/utils/dom";

/**
 * @zh 获取布局内容区域的样式
 * @en Get the style of the layout content area
 */
export function useLayoutContentStyle() {
	const contentElementRef = useRef<HTMLDivElement>(null);
	const [visibleDomRect, setVisibleDomRect] = useState<VisibleDomRect | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);

	const contentHeightControls = useCssVar(CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT);
	const contentWidthControls = useCssVar(CSS_VARIABLE_LAYOUT_CONTENT_WIDTH);

	const overlayStyle = useMemo<CSSProperties>(() => {
		const { height, left, top, width } = visibleDomRect || {};
		return {
			height: `${height}px`,
			left: `${left}px`,
			position: "fixed",
			top: `${top}px`,
			width: `${width}px`,
			zIndex: 150,
		};
	}, [visibleDomRect]);

	const debouncedCalcHeight = useDebounceFn(
		(_entries: ResizeObserverEntry[]) => {
			const rect = getElementVisibleRect(contentElementRef.current);
			setVisibleDomRect(rect);
			if (rect) {
				contentHeightControls.set(`${rect.height}px`);
				contentWidthControls.set(`${rect.width}px`);
			}
		},
		{ wait: 16 },
	);

	useEffect(() => {
		if (contentElementRef.current && !resizeObserverRef.current) {
			// eslint-disable-next-line react/web-api-no-leaked-resize-observer -- cleanup 已统一 disconnect（规则识别不了 ref 间接持有）
			const resizeObserver = new ResizeObserver(debouncedCalcHeight.run);
			resizeObserverRef.current = resizeObserver;
			resizeObserver.observe(contentElementRef.current);
		}

		return () => {
			resizeObserverRef.current?.disconnect();
			resizeObserverRef.current = null;
		};
	}, [debouncedCalcHeight]);

	return { contentElementRef, overlayStyle, visibleDomRect };
}

export function useLayoutHeaderStyle() {
	const cssVarControls = useCssVar(CSS_VARIABLE_LAYOUT_HEADER_HEIGHT);

	return {
		getLayoutHeaderHeight: () => {
			return Number.parseInt(`${cssVarControls.get()}`, 10);
		},
		setLayoutHeaderHeight: (height: number) => {
			cssVarControls.set(`${height}px`);
		},
	};
}

export function useLayoutFooterStyle() {
	const cssVarControls = useCssVar(CSS_VARIABLE_LAYOUT_FOOTER_HEIGHT);

	return {
		getLayoutFooterHeight: () => {
			return Number.parseInt(`${cssVarControls.get()}`, 10);
		},
		setLayoutFooterHeight: (height: number) => {
			cssVarControls.set(`${height}px`);
		},
	};
}
