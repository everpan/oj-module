// ram-api:stub getTodoList sha256:b9a60daaf0f1b6cb11276c303e120a76b9c3556ac190e8203627059cd715b127
function get(): void {
	json.ok({
		list: [{
			id: 1,
			title: "示例",
			done: true,
		}],
		total: 1,
	});
}
export default { get };
