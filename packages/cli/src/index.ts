import process from "node:process";
import { buildCli, localizeCacError, reportCliError, rewriteHelpArgv, unknownCommandResult } from "./cli";
import { isKnownCommand, resolveLang, usageText } from "./usage";
import { readCliVersion } from "./versions";

async function main() {
	const lang = resolveLang();
	const argv = process.argv.slice(2);

	// 顶层 --version / -V：裸版本号（与 ojm info 同源）；不经 cac，避免其 platformInfo 后缀
	if (argv[0] === "--version" || argv[0] === "-V") {
		console.log(readCliVersion());
		return;
	}

	const rewritten = rewriteHelpArgv(argv);
	const cli = buildCli(process.cwd(), lang, { argv: rewritten });
	let unknown: string | undefined;
	cli.on("command:*", () => {
		// cac 在 --help 输出后会 unsetMatchedCommand 再发 command:*（args[0] 可能是子命令，如 verify）——
		// 误判根源。按「首位置参数是否是已知命令」判定：market 等已知命令的子命令不误判，未知首参才兜底
		const first = rewritten.find(a => !a.startsWith("-"));
		if (first !== undefined && !isKnownCommand(first))
			unknown = first;
	});
	cli.parse(["node", "ojm", ...rewritten]);

	// 未知命令：help 形态报「未知命令」、否则打帮助；均 exit 1（裸 ojm 打帮助退 0 不变）
	if (unknown !== undefined) {
		const r = unknownCommandResult(unknown, lang, !!cli.options.help);
		if (cli.options.help)
			console.error(r.text);
		else
			console.log(r.text);
		process.exit(r.code);
	}
	if (argv.length === 0)
		console.log(usageText(lang));
}

main().catch((error: unknown) => reportCliError(localizeCacError(error, resolveLang()), (code) => {
	process.exit(code);
}, process.argv.slice(2)));
