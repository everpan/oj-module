// ram-api:stub fetchRoleMenu sha256:431b25f7b59c81f3a79d78c519c8b21e11ed423a65ba5fdd00f0d843b5e7c5a0
function get(): void {
	json.ok([{
		parentId: 1,
		id: 1,
		menuType: 1,
		name: "示例",
	}]);
}
export default { get };
