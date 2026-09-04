// ram-api:stub fetchRoleList sha256:e042ba6c59d9590a6281300cc4a65408345df7be1c55ee65230d76c7fbdbdbb6
function get(): void {
	json.ok({
		list: [{
			id: 1,
			createTime: 1,
			updateTime: 1,
			name: "示例",
			code: "示例",
			status: 1,
			remark: "示例",
		}],
		total: 1,
		pageSize: 1,
		current: 1,
	});
}
export default { get };
