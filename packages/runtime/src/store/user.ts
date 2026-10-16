import type { UserInfoType } from "#src/api/user/types";
import { create } from "zustand";

import { fetchUserInfo } from "#src/api/user";
import { getAuthProvider } from "#src/store/auth-provider";

import { openMustChangeModal } from "#src/utils/request/must-change";

const initialState = {
	id: "",
	avatar: "",
	username: "",
	email: "",
	phoneNumber: "",
	description: "",
	roles: [],
	// menus: [],
};

type UserState = UserInfoType;

interface UserAction {
	getUserInfo: () => Promise<UserInfoType>
	reset: () => void
};

export const useUserStore = create<UserState & UserAction>()(

	set => ({
		...initialState,

		getUserInfo: async () => {
			const provider = getAuthProvider();
			// AC-D16：fetchUserInfo 直返 data，无 .result 信封
			const result = provider
				? await provider.getUserInfo()
				: await fetchUserInfo();
			set({ ...result });
			// 首登须改密：主动弹引导框（阻塞性），不等用户去踩管理接口 403。
			// 后端 user-info 下发蛇形字段 must_change，UserInfoType 类型为驼峰，
			// 取两者兼容（react-query 等消费方能拿到驼峰，这里以原始响应为准）。
			const raw = result as unknown as Record<string, unknown>;
			if (raw.must_change === true || result.mustChange === true) {
				openMustChangeModal();
			}
			return result;
		},

		reset: () => {
			return set({
				...initialState,
			});
		},

	}),

);
