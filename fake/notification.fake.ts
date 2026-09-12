import { defineFakeRoute } from "vite-plugin-fake-server/client";

import { ojOk } from "./utils";

export default defineFakeRoute([
	{
		url: "/notifications",
		timeout: 1000,
		method: "get",
		response: () => ojOk([
			{
				id: 1,
				avatar: "https://avatar.vercel.sh/vercel.svg?text=VC",
				date: "3 小时前",
				isRead: true,
				message: "描述信息描述信息描述信息",
				title: "收到了 14 份新周报",
			},
			{
				id: 2,
				avatar: "https://avatar.vercel.sh/1",
				date: "刚刚",
				isRead: false,
				message: "描述信息描述信息描述信息",
				title: "Tom 回复了你",
			},
			{
				id: 3,
				avatar: "https://avatar.vercel.sh/2",
				date: "2024-10-10",
				isRead: false,
				message: "描述信息描述信息描述信息",
				title: "Jack 评论了你",
			},
			{
				id: 4,
				avatar: "https://avatar.vercel.sh/Jack",
				date: "1 天前",
				isRead: false,
				message: "描述信息描述信息描述信息",
				title: "代办提醒",
			},
		]),
	},

]);
