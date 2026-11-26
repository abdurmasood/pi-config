/**
 * Context Footer
 *
 * Compact (default):
 *   pnp · main                                   sonnet · high   ◔ 48%
 *
 * Expanded (toggle with alt+c or /ctx): context breakdown
 *   █████▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒░░░·······························  48%
 *   █ sys 9%  ▓ chat 16%  ▒ tools 22%  ░ files 5%        480k / 1.0M
 *
 * The breakdown is estimated (chars/4) per category, then scaled to the
 * real context usage reported by pi.
 */

import { basename } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateTokens, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Category = "sys" | "chat" | "tools" | "files" | "summary";

const CATEGORIES: { key: Category; glyph: string; color: string }[] = [
	{ key: "sys", glyph: "█", color: "muted" },
	{ key: "chat", glyph: "▓", color: "accent" },
	{ key: "tools", glyph: "▒", color: "syntaxFunction" },
	{ key: "files", glyph: "░", color: "syntaxString" },
	{ key: "summary", glyph: "▪", color: "syntaxKeyword" },
];

const FILE_TOOLS = new Set(["read"]);

const fmtTokens = (n: number) =>
	n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;

const pie = (pct: number) => (pct < 12.5 ? "○" : pct < 37.5 ? "◔" : pct < 62.5 ? "◑" : pct < 87.5 ? "◕" : "●");

const pctColor = (pct: number) => (pct >= 80 ? "error" : pct >= 50 ? "warning" : "dim");

const thinkingColor = (level: string) =>
	({
		off: "thinkingOff",
		minimal: "thinkingMinimal",
		low: "thinkingLow",
		medium: "thinkingMedium",
		high: "thinkingHigh",
		xhigh: "thinkingXhigh",
	})[level] ?? "dim";

export default function (pi: ExtensionAPI) {
	let expanded = false;
	let requestRender: (() => void) | undefined;
	let cache: { key: string; est: Record<Category, number> } | undefined;

	function estimateBreakdown(ctx: ExtensionContext): Record<Category, number> {
		const systemPrompt = ctx.getSystemPrompt();
		const key = `${ctx.sessionManager.getLeafId()}:${systemPrompt.length}`;
		if (cache?.key === key) return cache.est;

		const est: Record<Category, number> = { sys: 0, chat: 0, tools: 0, files: 0, summary: 0 };

		// System prompt + tool schemas
		let sysChars = systemPrompt.length;
		const active = new Set(pi.getActiveTools());
		for (const t of pi.getAllTools()) {
			if (!active.has(t.name)) continue;
			sysChars += t.name.length + (t.description?.length ?? 0) + JSON.stringify(t.parameters ?? {}).length;
		}
		est.sys += Math.ceil(sysChars / 4);

		let messages: AgentMessage[] = [];
		try {
			messages = ctx.sessionManager.buildSessionProjection().messages;
		} catch {}

		for (const m of messages as any[]) {
			const tokens = estimateTokens(m);
			switch (m.role) {
				case "system":
					est.sys += tokens;
					break;
				case "user":
				case "custom":
					est.chat += tokens;
					break;
				case "assistant": {
					let talk = 0;
					let calls = 0;
					for (const b of m.content ?? []) {
						if (b.type === "text") talk += b.text.length;
						else if (b.type === "thinking") talk += b.thinking.length;
						else if (b.type === "toolCall") calls += b.name.length + JSON.stringify(b.arguments ?? {}).length;
					}
					const total = talk + calls || 1;
					est.chat += (tokens * talk) / total;
					est.tools += (tokens * calls) / total;
					break;
				}
				case "toolResult":
					if (FILE_TOOLS.has(m.toolName)) est.files += tokens;
					else est.tools += tokens;
					break;
				case "bashExecution":
					if (!m.excludeFromContext) est.tools += tokens;
					break;
				case "compactionSummary":
				case "branchSummary":
					est.summary += tokens;
					break;
				default:
					est.chat += tokens;
			}
		}

		cache = { key, est };
		return est;
	}

	function fit(left: string, right: string, width: number): string {
		const pad = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
		return truncateToWidth(left + " ".repeat(pad) + right, width);
	}

	function install(ctx: ExtensionContext) {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			const fg = (color: string, text: string) => theme.fg(color as any, text);

			function compact(width: number): string[] {
				const folder = basename(ctx.cwd);
				const branch = footerData.getGitBranch();
				const statuses = [...footerData.getExtensionStatuses().values()].filter(Boolean);

				const usage = ctx.getContextUsage();
				const pct = usage?.percent;
				const ctxPart =
					pct == null ? fg("dim", "○ —") : fg(pctColor(pct), `${pie(pct)} ${Math.round(pct)}%`);

				const modelId = ctx.model?.id ?? "no model";
				const level = pi.getThinkingLevel();
				const showThinking = ctx.model?.reasoning && level && level !== "off";
				const modelPart =
					fg("dim", modelId) + (showThinking ? fg("dim", " · ") + fg(thinkingColor(level), level) : "");

				const sep = fg("dim", " · ");
				const where = fg("muted", folder) + (branch ? sep + fg("dim", branch) : "");
				const status = statuses.length ? sep + statuses.join(sep) : "";

				// Drop parts from least to most important until it fits
				const candidates: [string, string][] = [
					[where + status, `${modelPart}   ${ctxPart}`],
					[where, `${modelPart}   ${ctxPart}`],
					[fg("muted", folder), `${modelPart}   ${ctxPart}`],
					[fg("muted", folder), ctxPart],
					["", ctxPart],
				];
				for (const [l, r] of candidates) {
					if (visibleWidth(l) + visibleWidth(r) + 1 <= width) return [fit(l, r, width)];
				}
				return [fit("", ctxPart, width)];
			}

			function breakdown(width: number): string[] {
				const usage = ctx.getContextUsage();
				const window = usage?.contextWindow || ctx.model?.contextWindow || 0;
				const est = estimateBreakdown(ctx);
				const estTotal = CATEGORIES.reduce((s, c) => s + est[c.key], 0) || 1;
				const actual = usage?.tokens ?? estTotal;
				const scale = actual / estTotal;
				const pct = usage?.percent ?? (window ? (actual / window) * 100 : 0);

				const pctText = fg(pctColor(pct), `${Math.round(pct)}%`);
				const barWidth = Math.max(10, width - visibleWidth(pctText) - 2);

				// Cumulative rounding so segments add up exactly
				let bar = "";
				let cum = 0;
				let drawn = 0;
				for (const c of CATEGORIES) {
					cum += est[c.key] * scale;
					const end = window ? Math.min(barWidth, Math.round((cum / window) * barWidth)) : 0;
					if (end > drawn) bar += fg(c.color, c.glyph.repeat(end - drawn));
					drawn = Math.max(drawn, end);
				}
				bar += fg("dim", "·".repeat(Math.max(0, barWidth - drawn)));

				const legend = CATEGORIES.filter((c) => est[c.key] > 0)
					.map((c) => {
						const p = window ? (est[c.key] * scale * 100) / window : 0;
						return fg(c.color, c.glyph) + fg("dim", ` ${c.key} ${p < 1 && p > 0 ? "<1" : Math.round(p)}%`);
					})
					.join("  ");
				const totals = fg("dim", `${fmtTokens(Math.round(actual))} / ${fmtTokens(window)}`);

				return [truncateToWidth(`${bar}  ${pctText}`, width), fit(legend, totals, width)];
			}

			return {
				dispose() {
					unsub();
					requestRender = undefined;
				},
				invalidate() {
					cache = undefined;
				},
				render(width: number): string[] {
					return expanded ? breakdown(width) : compact(width);
				},
			};
		});
	}

	const toggle = (ctx: ExtensionContext) => {
		expanded = !expanded;
		if (requestRender) requestRender();
		else install(ctx);
	};

	pi.on("session_start", async (_e, ctx) => {
		cache = undefined;
		install(ctx);
	});
	pi.on("model_select", async () => requestRender?.());
	pi.on("thinking_level_select", async () => requestRender?.());

	pi.registerShortcut("alt+c", {
		description: "Toggle context breakdown in footer",
		handler: async (ctx) => toggle(ctx),
	});

	pi.registerCommand("ctx", {
		description: "Toggle context breakdown in footer",
		handler: async (_args, ctx) => toggle(ctx),
	});
}
