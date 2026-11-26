/**
 * Generates the README preview images (docs/*.svg) from the real extension code,
 * rendered with the colors of themes/black-mono.json.
 *
 * Run: ./scripts/previews.sh
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import askMode from "../extensions/ask-mode.ts";
import contextFooter from "../extensions/context-footer.ts";

const OUT = process.env.OUT_DIR ?? "docs";
const THEME = process.env.THEME_FILE ?? "themes/black-mono.json";

// ---------- theme ----------

const themeJson = JSON.parse(readFileSync(THEME, "utf8"));
const resolve = (v: string): string => (v?.startsWith("#") ? v : themeJson.vars[v] ?? "#e0e0e0");
const color = (token: string) => resolve(themeJson.colors[token] ?? token);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(";");
const theme = { fg: (token: string, text: string) => `\x1b[38;2;${rgb(color(token))}m${text}\x1b[39m` };

const BG = themeJson.export?.pageBg ?? "#000000";
const CHROME = themeJson.export?.cardBg ?? "#121212";
const TEXT = color("text");

// ---------- ANSI -> spans -> SVG ----------

type Span = { text: string; fg: string; col: number };

function parseAnsi(line: string): Span[] {
	const spans: Span[] = [];
	let fg = TEXT;
	let col = 0;
	for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
		const m = part.match(/^\x1b\[([0-9;]*)m$/);
		if (m) {
			const codes = m[1].split(";");
			if (codes[0] === "38" && codes[1] === "2") fg = `#${codes.slice(2, 5).map((n) => (+n).toString(16).padStart(2, "0")).join("")}`;
			else if (codes[0] === "39" || codes[0] === "0") fg = TEXT;
			continue;
		}
		if (!part) continue;
		spans.push({ text: part, fg, col });
		col += [...part].length;
	}
	return spans;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Row = { line: string; bg?: string; gapBefore?: number };

const CW = 8.4; // char width at 14px
const LH = 22;
const PAD = 20;
const BAR = 34;

function svg(title: string, cols: number, rows: Row[]): string {
	const width = Math.round(cols * CW + PAD * 2);
	let y = BAR + PAD;
	const body: string[] = [];
	for (const row of rows) {
		y += row.gapBefore ?? 0;
		if (row.bg) body.push(`<rect x="${PAD - 8}" y="${y - 2}" width="${width - PAD * 2 + 16}" height="${LH}" fill="${row.bg}"/>`);
		const tspans = parseAnsi(row.line)
			.filter((s) => s.text.trim())
			.map((s) => `<tspan x="${(PAD + s.col * CW).toFixed(1)}" fill="${s.fg}">${esc(s.text)}</tspan>`)
			.join("");
		body.push(`<text y="${y + 15}">${tspans}</text>`);
		y += LH;
	}
	const height = y + PAD - 4;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:14px;white-space:pre}</style>
<rect width="${width}" height="${height}" rx="10" fill="${BG}" stroke="#2a2a2a"/>
<path d="M0 10a10 10 0 0 1 10-10h${width - 20}a10 10 0 0 1 10 10v${BAR - 10}h-${width}z" fill="${CHROME}"/>
<circle cx="18" cy="17" r="5.5" fill="#ff5f57"/><circle cx="36" cy="17" r="5.5" fill="#febc2e"/><circle cx="54" cy="17" r="5.5" fill="#28c840"/>
<text x="${width / 2}" y="22" text-anchor="middle" style="font-size:12px" fill="${color("dim")}">${esc(title)}</text>
${body.join("\n")}
</svg>
`;
}

// ---------- mocks ----------

function mockPi(extra: Record<string, unknown> = {}) {
	const handlers: Record<string, Function> = {};
	const shortcuts: Record<string, { handler: Function }> = {};
	const pi: any = {
		on: (e: string, f: Function) => (handlers[e] = f),
		registerShortcut: (k: string, o: any) => (shortcuts[k] = o),
		registerCommand() {},
		appendEntry() {},
		getActiveTools: () => ["read", "bash", "edit", "write"],
		getAllTools: () => [{ name: "read", description: "Read a file", parameters: { type: "object" } }],
		getThinkingLevel: () => "high",
		...extra,
	};
	return { pi, handlers, shortcuts };
}

const messages = [
	{ role: "user", content: "x".repeat(60_000) },
	{ role: "assistant", content: [{ type: "text", text: "x".repeat(60_000) }, { type: "toolCall", name: "read", arguments: { path: "src" } }] },
	{ role: "toolResult", toolName: "read", content: [{ type: "text", text: "x".repeat(160_000) }] },
	{ role: "toolResult", toolName: "bash", content: [{ type: "text", text: "x".repeat(260_000) }] },
	{ role: "compactionSummary", summary: "x".repeat(30_000) },
];

function footer(opts: { pct: number; branch: string; statuses?: [string, string][] }) {
	const { pi, handlers, shortcuts } = mockPi();
	contextFooter(pi);
	let component: any;
	const ctx: any = {
		mode: "tui",
		cwd: "/Users/me/pnp",
		model: { id: "claude-opus-5-5", reasoning: true, contextWindow: 1_000_000 },
		getContextUsage: () => ({ tokens: opts.pct * 10_000, contextWindow: 1_000_000, percent: opts.pct }),
		getSystemPrompt: () => "x".repeat(50_000),
		sessionManager: { getLeafId: () => `leaf-${opts.pct}`, buildSessionProjection: () => ({ messages }) },
		ui: {
			setFooter: (f: Function) =>
				(component = f({ requestRender() {} }, theme, {
					getGitBranch: () => opts.branch,
					getExtensionStatuses: () => new Map(opts.statuses ?? []),
					onBranchChange: () => () => {},
				})),
		},
	};
	handlers.session_start({}, ctx);
	return { render: (w: number) => component.render(w) as string[], toggle: () => shortcuts["alt+c"].handler(ctx) };
}

async function askModeTranscript() {
	const { pi, handlers, shortcuts } = mockPi();
	askMode(pi);
	let status: string | undefined;
	const ctx: any = {
		hasUI: true,
		sessionManager: { getBranch: () => [] },
		ui: { theme, setStatus: (_k: string, v?: string) => (status = v), notify() {}, select: async () => "Run once" },
	};
	await handlers.session_start({}, ctx);
	await shortcuts["shift+tab"].handler(ctx);
	const blocked = await handlers.tool_call({ toolName: "edit", input: {} }, ctx);
	const blockedBash = await handlers.tool_call({ toolName: "bash", input: { command: "rm -rf dist" } }, ctx);
	return { status: status!, blocked: blocked.reason as string, blockedBash: blockedBash.reason as string };
}

// ---------- build ----------

const COLS = 84;
mkdirSync(OUT, { recursive: true });

// 1. Footer states
{
	const rows: Row[] = [
		{ line: theme.fg("dim", "under 50%") },
		{ line: footer({ pct: 8, branch: "main" }).render(COLS)[0] },
		{ line: theme.fg("dim", "50% and up"), gapBefore: 10 },
		{ line: footer({ pct: 58, branch: "main" }).render(COLS)[0] },
		{ line: theme.fg("dim", "80% and up"), gapBefore: 10 },
		{ line: footer({ pct: 87, branch: "feature/auth" }).render(COLS)[0] },
	];
	writeFileSync(join(OUT, "footer.svg"), svg("context footer", COLS, rows));
}

// 2. Context breakdown (alt+c)
{
	const f = footer({ pct: 64, branch: "main" });
	f.toggle();
	const [bar, legend] = f.render(COLS);
	writeFileSync(join(OUT, "context.svg"), svg("⌥C  context breakdown", COLS, [{ line: bar }, { line: legend }]));
}

// 3. Ask mode (illustrative transcript; strings come from the real extension)
{
	const t = await askModeTranscript();
	const wrap = (s: string, w: number) => s.match(new RegExp(`.{1,${w}}(\\s|$)`, "g"))!.map((l) => l.trimEnd());
	const errBg = color("toolErrorBg");
	const okBg = color("toolSuccessBg");
	const rows: Row[] = [
		{ line: theme.fg("toolTitle", "edit ") + theme.fg("accent", "src/app.ts"), bg: errBg },
		...wrap(t.blocked, COLS - 2).map((l) => ({ line: theme.fg("error", l), bg: errBg })),
		{ line: theme.fg("toolTitle", "$ ") + theme.fg("text", "rm -rf dist"), bg: errBg, gapBefore: 10 },
		...wrap(t.blockedBash, COLS - 2).map((l) => ({ line: theme.fg("error", l), bg: errBg })),
		{ line: theme.fg("toolTitle", "$ ") + theme.fg("text", "git log --oneline -2"), bg: okBg, gapBefore: 10 },
		{ line: theme.fg("toolOutput", "2a35f08 Minimal README"), bg: okBg },
		{ line: theme.fg("toolOutput", "3d396a6 Initial pi-config"), bg: okBg },
		{ line: theme.fg("warning", "Ask mode: `pnpm test` isn't a known read-only command"), gapBefore: 10 },
		{ line: theme.fg("text", "  pnpm test") },
		{ line: theme.fg("accent", "→ Run once") },
		{ line: theme.fg("muted", "  Block") },
		{ line: footer({ pct: 23, branch: "main", statuses: [["ask-mode", t.status]] }).render(COLS)[0], gapBefore: 14 },
	];
	writeFileSync(join(OUT, "ask-mode.svg"), svg("⇧Tab  ask mode", COLS, rows));
}

console.log(`Wrote ${OUT}/footer.svg, context.svg, ask-mode.svg`);
