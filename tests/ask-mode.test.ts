import assert from "node:assert/strict";
import askMode, { __test } from "../extensions/ask-mode.ts";

const { classifyCommand } = __test;

// ---------- bash classification ----------

const expectations: Record<"allow" | "ask" | "block", string[]> = {
	allow: [
		"ls -la",
		"cat src/a.ts | head -50",
		"rg 'foo > bar' src",
		'grep -rn "rm -rf" .',
		"git status && git log --oneline -5",
		"git -C ../x log",
		"git branch -a",
		"git stash list",
		"git config --get user.name",
		"git remote -v",
		"find . -name '*.ts' 2>/dev/null",
		"cat a 2>&1 | wc -l",
		"sed -n '1,20p' f",
		"npm ls",
		"node --version",
		"FOO=1 ls",
		"cd src && ls",
		"cat <<'EOF' | wc -l\nrm -rf /\nEOF",
		"command -v pi",
	],
	ask: [
		"git fetch",
		"find . -exec grep foo {} \\;",
		"pnpm test",
		"npx tsc",
		"npm run build",
		"node script.js",
		"curl -s https://example.com",
		"env FOO=1 node x",
		"echo $(whoami)",
		"make build",
	],
	block: [
		"git branch feature",
		"git branch -D old",
		"git stash",
		"git tag v1",
		"git config user.name bob",
		"git remote add o url",
		"git commit -m 'x'",
		"git push",
		"find . -name x -delete",
		"ls | xargs rm",
		"echo hi > out.txt",
		"echo hi >> log",
		"cat > f <<EOF\nhi\nEOF",
		"sed -i 's/a/b/' f",
		"rm -rf node_modules",
		"mkdir x",
		"npm install",
		"sudo ls",
		"tee out",
	],
};

for (const [kind, commands] of Object.entries(expectations)) {
	for (const cmd of commands) {
		assert.equal(classifyCommand(cmd).kind, kind, `expected ${kind}: ${JSON.stringify(cmd)}`);
	}
}

// ---------- extension behaviour ----------

const handlers: Record<string, Function> = {};
const shortcuts: Record<string, { handler: Function }> = {};
const entries: any[] = [];
const pi: any = {
	on: (e: string, f: Function) => (handlers[e] = f),
	registerShortcut: (k: string, o: any) => (shortcuts[k] = o),
	registerCommand() {},
	appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
};
askMode(pi);

let status: string | undefined;
const answers: string[] = [];
const ctx: any = {
	hasUI: true,
	sessionManager: { getBranch: () => entries },
	ui: {
		theme: { fg: (_c: string, t: string) => t },
		setStatus: (_k: string, v: string | undefined) => (status = v),
		notify() {},
		select: async () => answers.shift(),
	},
};

assert.ok(shortcuts["shift+tab"], "shift+tab registered");
await handlers.session_start({}, ctx);
assert.equal(status, undefined);

await shortcuts["shift+tab"].handler(ctx);
assert.equal(status, "◉ ask");
assert.match((await handlers.before_agent_start({ messageType: "user" })).message.content, /ASK MODE ON/);

const call = (toolName: string, input: any = {}) => handlers.tool_call({ toolName, input }, ctx);
assert.equal(await call("read"), undefined);
assert.equal((await call("edit")).block, true);
assert.equal(await call("bash", { command: "git log" }), undefined);
assert.equal((await call("bash", { command: "rm x" })).block, true);
answers.push("Run once");
assert.equal(await call("bash", { command: "pnpm test" }), undefined);
answers.push("Block");
assert.equal((await call("bash", { command: "pnpm test" })).block, true);
answers.push("Always allow this session");
assert.equal(await call("mcp_search"), undefined);
assert.equal(await call("mcp_search"), undefined, "remembered for the session");

// state survives a resume
await handlers.session_start({}, ctx);
assert.equal(status, "◉ ask");

await shortcuts["shift+tab"].handler(ctx);
assert.equal(status, undefined);
assert.match((await handlers.before_agent_start({ messageType: "user" })).message.content, /ASK MODE OFF/);
assert.equal(await handlers.before_agent_start({ messageType: "user" }), undefined, "off notice only once");
assert.equal(await call("edit"), undefined, "edits allowed when off");
