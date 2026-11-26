import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import contextFooter from "../extensions/context-footer.ts";

const handlers: Record<string, Function> = {};
const shortcuts: Record<string, { handler: Function }> = {};
const pi: any = {
	on: (e: string, f: Function) => (handlers[e] = f),
	registerShortcut: (k: string, o: any) => (shortcuts[k] = o),
	registerCommand() {},
	getActiveTools: () => ["read"],
	getAllTools: () => [{ name: "read", description: "Read a file", parameters: { type: "object" } }],
	getThinkingLevel: () => "high",
};
contextFooter(pi);

const messages = [
	{ role: "user", content: "hello there ".repeat(2000) },
	{ role: "assistant", content: [{ type: "text", text: "ok ".repeat(3000) }, { type: "toolCall", name: "read", arguments: { path: "x" } }] },
	{ role: "toolResult", toolName: "read", content: [{ type: "text", text: "file ".repeat(20000) }] },
	{ role: "toolResult", toolName: "bash", content: [{ type: "text", text: "out ".repeat(30000) }] },
];

let footer: any;
const ctx: any = {
	mode: "tui",
	cwd: "/home/me/pnp",
	model: { id: "claude-sonnet-4-5", reasoning: true, contextWindow: 200000 },
	getContextUsage: () => ({ tokens: 96000, contextWindow: 200000, percent: 48 }),
	getSystemPrompt: () => "x".repeat(40000),
	sessionManager: { getLeafId: () => "leaf", buildSessionProjection: () => ({ messages }) },
	ui: {
		setFooter: (factory: Function) =>
			(footer = factory(
				{ requestRender() {} },
				{ fg: (_c: string, t: string) => t },
				{ getGitBranch: () => "main", getExtensionStatuses: () => new Map([["ask-mode", "◉ ask"]]), onBranchChange: () => () => {} },
			)),
	},
};

await handlers.session_start({}, ctx);

// compact view
const [wide] = footer.render(100);
assert.match(wide, /^pnp · main · ◉ ask +claude-sonnet-4-5 · high +◑ 48%$/);
assert.equal(visibleWidth(wide), 100);

// narrow: least important parts dropped, context % kept
const [narrow] = footer.render(24);
assert.match(narrow, /◑ 48%$/);
assert.ok(visibleWidth(narrow) <= 24);

// breakdown view via alt+c
await shortcuts["alt+c"].handler(ctx);
const lines = footer.render(90);
assert.equal(lines.length, 2);
assert.match(lines[0], /48%$/);
assert.match(lines[1], /sys \d+%.*chat \d+%.*tools \d+%.*files \d+%.*96k \/ 200k$/);
for (const l of lines) assert.ok(visibleWidth(l) <= 90);

await shortcuts["alt+c"].handler(ctx);
assert.equal(footer.render(90).length, 1, "toggles back");
