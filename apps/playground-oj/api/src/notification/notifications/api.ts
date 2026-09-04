// ram-api:stub fetchNotifications sha256:469a144459f5d401dff34e96f6aef260daf2236d274127e93c5d0fda8c5746c9
function get(): void {
	json.ok([{
		avatar: "示例",
		date: "示例",
		isRead: true,
		message: "示例",
		title: "示例",
	}]);
}
export default { get };
