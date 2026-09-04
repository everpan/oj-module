// ram-api:stub fetchAddRoleItem,fetchDeleteRoleItem,fetchUpdateRoleItem sha256:54bee6144540a4e6f7def98ae09e7c5fad71ba1e698aefb5d2229e26d249a5a1
function post(): void {
	json.ok({
		id: 1,
		name: "示例",
		code: "示例",
		status: 1,
		remark: "示例",
		menus: [1],
	});
}

function put(): void {
	json.ok({
		id: 1,
		name: "示例",
		code: "示例",
		status: 1,
		remark: "示例",
		menus: [1],
	});
}

function del(): void {
	json.ok(1);
}
export default { post, put, del };
