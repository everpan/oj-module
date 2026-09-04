// ram-api:stub fetchMenuList sha256:1d2ffec8297ec2b5cab11c49c5dce5d49a814daf652f963c687d52fa734dcec7
function get(): void {
	json.ok({
		list: [{
			parentId: 1,
			id: 1,
			menuType: 1,
			name: "示例",
		}],
		total: 1,
		current: 1,
	});
}
export default { get };
