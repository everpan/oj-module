import process from "node:process";
import { buildCli, reportCliError, rewriteHelpArgv } from "./cli";
import { resolveLang, usageText } from "./usage";
import { readCliVersion } from "./versions";

async function main() {
	const lang = resolveLang();
	const argv = process.argv.slice(2);

	// 顶层 --version / -V：裸版本号（与 ojm info 同源）；不经 cac，避免其 platformInfo 后缀
	if (argv[0] === "--version" || argv[0] === "-V") {
		console.log(readCliVersion());
		return;
	}

	const cli = buildCli(process.cwd(), lang);
	let unknown: string | undefined;
	cli.on("command:*", () => {
		// cac 在 --help 输出后会 unsetMatchedCommand，此时 args[0] 是子命令（如 verify）——
		// 只有非 help 请求里的 command:* 才是真正的未知命令
		if (!cli.options.help)
			unknown = String(cli.args[0]);
	});
	cli.parse(["node", "ojm", ...rewriteHelpArgv(argv)]);

	// 未知命令：打帮助退 1；裸 ojm：打帮助退 0（与旧 usage() 语义一致）
	if (unknown !== undefined) {
		console.log(usageText(lang));
		process.exit(1);
	}
	if (argv.length === 0)
		console.log(usageText(lang));
}

main().catch((error: unknown) => reportCliError(error, (code) => {
	process.exit(code);
}));
