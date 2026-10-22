import { theme } from "antd";
import { GlobalSpin } from "#src/components/global-spin";
import { Scrollbar } from "#src/components/scrollbar";
import { useLayoutContentStyle } from "#src/hooks/use-layout-style";
import { CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT, ELEMENT_ID_MAIN_CONTENT } from "#src/layout/constants";

import KeepAliveLayer from "#src/layout/keep-alive-layer";
import LayoutFooter from "#src/layout/layout-footer";
import { usePreferencesStore } from "#src/store/preferences";

export interface LayoutContentProps { }

export default function LayoutContent() {
	const {
		token: { colorBgLayout },
	} = theme.useToken();
	const { contentElementRef } = useLayoutContentStyle();

	const enableFooter = usePreferencesStore(state => state.enableFooter);
	const fixedFooter = usePreferencesStore(state => state.fixedFooter);

	/**
	 * 缓存层（KeepAlive）已上移至 shell 固定层 KeepAliveLayer，只包裹页面 outlet，
	 * 此处仅负责内容区的滚动容器与页脚（chrome 不进入缓存）。
	 */
	return (
		<main
			id={ELEMENT_ID_MAIN_CONTENT}
			ref={contentElementRef}
			className="relative overflow-y-auto overflow-x-hidden grow"
			style={
				{
					backgroundColor: colorBgLayout,
				}
			}
		>
			<Scrollbar>
				<GlobalSpin>
					<div
						className="flex flex-col h-full"
					>
						<div
							style={{
								height: `var(${CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT})`,
							}}
						>
							<KeepAliveLayer />
						</div>
						{enableFooter && !fixedFooter ? <LayoutFooter /> : null}
					</div>
				</GlobalSpin>
			</Scrollbar>

		</main>
	);
}
