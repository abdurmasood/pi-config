/**
 * Ask Mode
 *
 * Toggle with shift+tab (or alt+r, /ask). While on:
 * (shift+tab is freed by moving app.thinking.cycle to alt+t in ~/.pi/agent/keybindings.json)
 * - edit / write are blocked
 * - read / grep / find / ls run normally
 * - bash: known read-only commands run, destructive ones are blocked,
 *   anything uncertain asks you first
 * - any other tool asks you first (with "always allow this session")
 *
 * The tool list sent to the model is left unchanged (keeps the prompt cache
 * warm); instead the model gets a short notice with each prompt.
 * State is saved in the session, so resuming keeps the mode.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "ask-mode";
const LEGACY_ENTRY_TYPE = "read-only-mode";
const ALWAYS_ALLOWED_TOOLS = new Set(["read", "grep", "find", "ls"]);
const ALWAYS_BLOCKED_TOOLS = new Set(["edit", "write"]);
const SHELL_TOOLS = new Set(["bash"]);

// ---------- bash classification ----------

type Verdict = { kind: "allow" } | { kind: "ask"; why: string } | { kind: "block"; why: string };

const SAFE_COMMANDS = new Set([
	"cat", "head", "tail", "less", "more", "wc", "sort", "uniq", "diff", "cmp", "comm", "file", "stat",
	"du", "df", "tree", "which", "whereis", "type", "command", "pwd", "echo", "printf", "ls", "eza", "exa",
	"find", "fd", "grep", "egrep", "fgrep", "rg", "ag", "jq", "yq", "awk", "sed", "cut", "tr", "column",
	"nl", "basename", "dirname", "realpath", "readlink", "date", "cal", "whoami", "id", "uname", "env",
	"printenv", "ps", "uptime", "bat", "xxd", "hexdump", "od", "strings", "md5", "md5sum", "shasum",
	"sha256sum", "tokei", "cloc", "cd", "true", "false", "test", "[", "sleep", "seq", "tac", "rev",
	"fold", "fmt", "expand", "unexpand", "paste", "join", "lsof", "otool", "nm", "plutil",
]);

// Commands that are safe only without arguments (otherwise they run/change something)
const SAFE_BARE = new Set(["env", "defaults"]);

const GIT_READ = new Set([
	"status", "log", "diff", "show", "blame", "grep", "describe", "shortlog", "reflog", "rev-parse",
	"rev-list", "ls-files", "ls-tree", "ls-remote", "cat-file", "merge-base", "name-rev", "whatchanged",
	"for-each-ref", "show-ref", "count-objects", "check-ignore", "var", "help",
]);
const GIT_WRITE = new Set([
	"add", "commit", "push", "pull", "merge", "rebase", "reset", "checkout", "switch", "restore", "clean",
	"cherry-pick", "revert", "init", "clone", "rm", "mv", "apply", "am", "gc", "prune", "notes", "bisect",
]);

const PKG_READ = /^(npm|pnpm|yarn|bun)\s+(ls|list|why|view|info|outdated|audit|-v|--version|config\s+get)\b/;
const VERSION_CHECK = /^\S+\s+(--version|-v|-V|version)\s*$/;

const DESTRUCTIVE = [
	/\b(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|chgrp|ln|tee|truncate|dd|shred|install|unlink|rsync)\b/,
	/\bsed\b[^|;&]*\s-i/,
	/\bperl\b[^|;&]*\s-[a-z]*i/,
	/\bfind\b[^|;&]*\s-(delete|fprint\w*|fls)\b/,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|clean|cherry-pick|revert|init|clone|rm|mv|apply|am)\b/,
	/\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|rm|uninstall|update|up|upgrade|ci|link|unlink|publish|create|init)\b/,
	/\b(pip3?|uv|poetry|cargo|go|gem|brew|apt|apt-get)\s+(install|uninstall|remove|add|upgrade|update|build|run|get)\b/,
	/\b(sudo|su|doas|kill|pkill|killall|reboot|shutdown|launchctl|systemctl)\b/,
];

// Not necessarily destructive, but can run arbitrary things: ask
const ASK = [
	{ re: /\bfind\b[^|;&]*\s-(exec|execdir|ok|okdir)\b/, why: "find -exec runs other commands" },
	{ re: /\bxargs\b/, why: "xargs runs other commands" },
	{ re: /\$\(|`/, why: "command substitution" },
	{ re: /\b(vi|vim|nvim|nano|emacs|code|subl|open)\b/, why: "opens an editor or app" },
];

function classifyGit(args: string[]): Verdict {
	// skip global options: -C <path>, -c <k=v>, --no-pager, ...
	let i = 0;
	while (i < args.length && args[i].startsWith("-")) i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
	const sub = args[i];
	const rest = args.slice(i + 1);
	const positional = rest.filter((a) => !a.startsWith("-"));
	const has = (...flags: string[]) => rest.some((a) => flags.includes(a));

	if (!sub) return { kind: "allow" };
	if (GIT_READ.has(sub)) return { kind: "allow" };
	if (GIT_WRITE.has(sub)) return { kind: "block", why: `\`git ${sub}\` modifies the repo` };
	switch (sub) {
		case "branch":
			if (has("-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy", "-u", "--set-upstream-to"))
				return { kind: "block", why: "`git branch` with a modifying flag" };
			return positional.length === 0 || has("--contains", "--merged", "--no-merged", "--list", "-l")
				? { kind: "allow" }
				: { kind: "block", why: "`git branch <name>` creates a branch" };
		case "tag":
			return positional.length === 0 || has("-l", "--list", "--contains")
				? { kind: "allow" }
				: { kind: "block", why: "`git tag <name>` creates a tag" };
		case "remote":
			return positional.length === 0 || ["show", "get-url"].includes(positional[0])
				? { kind: "allow" }
				: { kind: "block", why: `\`git remote ${positional[0]}\` changes remotes` };
		case "config":
			return has("--get", "--get-all", "--get-regexp", "--list", "-l") || positional.length <= 1
				? { kind: "allow" }
				: { kind: "block", why: "`git config <key> <value>` changes config" };
		case "stash":
			return ["list", "show"].includes(positional[0])
				? { kind: "allow" }
				: { kind: "block", why: "`git stash` changes the working tree" };
		case "worktree":
			return positional[0] === "list" ? { kind: "allow" } : { kind: "block", why: "`git worktree` changes worktrees" };
		default:
			return { kind: "ask", why: `\`git ${sub}\` isn't known to be read-only` };
	}
}

/** Drop heredoc bodies and quoted string contents so their text isn't parsed as commands. */
function blankQuotes(cmd: string): string {
	return cmd
		.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, "<<$2$3")
		.replace(/'[^']*'/g, "''")
		.replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function classifySegment(seg: string): Verdict {
	// Strip leading env assignments: FOO=bar cmd
	const s = seg.trim().replace(/^(\w+=\S*\s+)+/, "");
	if (!s) return { kind: "allow" };
	const words = s.split(/\s+/);
	const [cmd, sub] = words;
	const name = cmd.replace(/^.*\//, "");

	if (name === "git") return classifyGit(words.slice(1));
	if (PKG_READ.test(s) || VERSION_CHECK.test(s)) return { kind: "allow" };
	if (name === "command" && (sub === "-v" || sub === "-V")) return { kind: "allow" };
	if (name === "curl" || name === "wget" || name === "http") return { kind: "ask", why: "network request" };
	if (SAFE_BARE.has(name)) return words.length === 1 ? { kind: "allow" } : { kind: "ask", why: `\`${name}\` with arguments` };
	if (SAFE_COMMANDS.has(name)) return { kind: "allow" };
	return { kind: "ask", why: `\`${name}${sub && !sub.startsWith("-") ? ` ${sub}` : ""}\` isn't a known read-only command` };
}

function classifyCommand(command: string): Verdict {
	const bare = blankQuotes(command)
		// harmless redirects
		.replace(/\d?>{1,2}\s*\/dev\/null/g, "")
		.replace(/\d?>&\d/g, "")
		.replace(/&>\s*\/dev\/null/g, "");

	for (const re of DESTRUCTIVE) {
		const m = bare.match(re);
		if (m) return { kind: "block", why: `\`${m[0].trim()}\` modifies files or system state` };
	}
	if (/>/.test(bare.replace(/<<-?\s*\S+/g, ""))) return { kind: "block", why: "output redirection writes a file" };

	let worst: Verdict = { kind: "allow" };
	for (const a of ASK) if (a.re.test(bare)) worst = { kind: "ask", why: a.why };
	for (const seg of bare.split(/\|\||&&|[|;&\n]/)) {
		const v = classifySegment(seg);
		if (v.kind === "block") return v;
		if (v.kind === "ask" && worst.kind === "allow") worst = v;
	}
	return worst;
}

// test hook
export const __test = { classifyCommand };

// ---------- extension ----------

export default function (pi: ExtensionAPI) {
	let enabled = false;
	let modelKnowsOn = false; // has the model been told ask mode is on?
	const sessionAllowedTools = new Set<string>();

	function updateStatus(ctx: ExtensionContext) {
		ctx.ui.setStatus(ENTRY_TYPE, enabled ? ctx.ui.theme.fg("warning", "◉ ask") : undefined);
	}

	function toggle(ctx: ExtensionContext) {
		enabled = !enabled;
		if (!enabled) sessionAllowedTools.clear();
		pi.appendEntry(ENTRY_TYPE, { enabled });
		updateStatus(ctx);
		ctx.ui.notify(enabled ? "Ask mode on: edits blocked" : "Ask mode off: full access", "info");
	}

	pi.registerShortcut("shift+tab", { description: "Toggle ask mode", handler: async (ctx) => toggle(ctx) });
	pi.registerShortcut("alt+r", { description: "Toggle ask mode", handler: async (ctx) => toggle(ctx) });
	pi.registerCommand("ask", {
		description: "Toggle ask mode (block edits and writes)",
		handler: async (_args, ctx) => toggle(ctx),
	});

	pi.on("session_start", async (_e, ctx) => {
		const last = ctx.sessionManager
			.getBranch()
			.filter((e: any) => e.type === "custom" && (e.customType === ENTRY_TYPE || e.customType === LEGACY_ENTRY_TYPE))
			.pop() as { data?: { enabled?: boolean } } | undefined;
		enabled = last?.data?.enabled ?? false;
		// A resumed session that had ask mode on already told the model; turning it off must say so.
		modelKnowsOn = enabled;
		sessionAllowedTools.clear();
		updateStatus(ctx);
	});

	// Tell the model (only on user prompts, and once when turning off)
	pi.on("before_agent_start", async (event) => {
		if (event.messageType !== "user") return;
		if (enabled) {
			modelKnowsOn = true;
			return {
				message: {
					customType: ENTRY_TYPE,
					display: false,
					content:
						"[ASK MODE ON] The user has enabled ask mode. Do not modify files or system state: " +
						"edit/write are blocked and bash is limited to read-only commands. Investigate, explain, and propose " +
						"changes (e.g. as diffs in your reply) instead of applying them. If changes are needed, tell the user " +
						"to turn off ask mode with shift+tab or /ask.",
				},
			};
		}
		if (modelKnowsOn) {
			modelKnowsOn = false;
			return {
				message: {
					customType: ENTRY_TYPE,
					display: false,
					content: "[ASK MODE OFF] The user turned off ask mode. You may edit files again.",
				},
			};
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!enabled) return;
		const tool = event.toolName;
		const blocked = (why: string) => ({
			block: true,
			reason: `Ask mode: ${why}. Turn it off with shift+tab or /ask to make changes.`,
		});

		if (ALWAYS_ALLOWED_TOOLS.has(tool) || sessionAllowedTools.has(tool)) return;
		if (ALWAYS_BLOCKED_TOOLS.has(tool)) return blocked(`\`${tool}\` is disabled`);

		if (SHELL_TOOLS.has(tool)) {
			const command = String((event.input as { command?: unknown }).command ?? "");
			const v = classifyCommand(command);
			if (v.kind === "allow") return;
			if (v.kind === "block") return blocked(v.why);
			if (!ctx.hasUI) return blocked(v.why);
			const choice = await ctx.ui.select(`Ask mode: ${v.why}\n\n  ${command}\n\nRun it?`, ["Run once", "Block"]);
			return choice === "Run once" ? undefined : blocked("command declined by user");
		}

		// Unknown tool (MCP, extension tools, ...)
		if (!ctx.hasUI) return blocked(`\`${tool}\` is not known to be read-only`);
		const choice = await ctx.ui.select(`Ask mode: allow tool \`${tool}\`?`, [
			"Allow once",
			"Always allow this session",
			"Block",
		]);
		if (choice === "Always allow this session") {
			sessionAllowedTools.add(tool);
			return;
		}
		return choice === "Allow once" ? undefined : blocked(`\`${tool}\` declined by user`);
	});
}
