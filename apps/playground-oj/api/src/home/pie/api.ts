// ram-api:stub fetchPie sha256:1c9ef0a37cb38ef784fbacc87a997a1572febf4657a6428693493a842ba640f8
function get(): void {
	json.ok([{
		value: 1,
		code: "示例",
	}]);
}
export default { get };
