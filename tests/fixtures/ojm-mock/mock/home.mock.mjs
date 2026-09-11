export default [
	{ url: "/home/line", method: "post", response: () => ({ code: 200, result: [1] }) },
	{ url: "/notifications", response: () => ({ code: 200, result: [] }) },
];
