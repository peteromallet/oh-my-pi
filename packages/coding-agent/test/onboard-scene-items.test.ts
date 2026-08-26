import { beforeAll, describe, expect, it } from "bun:test";
import type { ScanEntry } from "../src/modes/setup-wizard/onboard/scan";
import {
	authKindForEntry,
	buildProviderItems,
	probeThenPersist,
	preselectedEntry,
} from "../src/modes/setup-wizard/onboard/scenes";
import { initTheme, theme } from "../src/modes/theme/theme";

function entry(overrides: Partial<ScanEntry> & { provider: string }): ScanEntry {
	return { status: "missing", origin: null, defaultModel: null, ...overrides };
}

beforeAll(async () => {
	await initTheme();
});

const strip = (text: string): string => Bun.stripANSI(text);

describe("buildProviderItems markers", () => {
	const entries: ScanEntry[] = [
		entry({
			provider: "deepseek",
			status: "ready",
			origin: { kind: "env", detail: "DEEPSEEK_API_KEY" },
			defaultModel: "deepseek-v4-flash",
		}),
		entry({
			provider: "grok",
			status: "candidate",
			origin: { kind: "foreign-cli", detail: "~/.grok/auth.json" },
			defaultModel: null,
		}),
		entry({ provider: "openai", status: "missing" }),
	];

	it("prefixes ready rows with the success-tinted enabled dot and candidates with a neutral dot", () => {
		const { items } = buildProviderItems(entries.slice(0, 2), { showAll: false });
		expect(items[0]!.label).toContain(theme.fg("success", theme.status.enabled));
		expect(strip(items[0]!.label)).not.toContain(theme.status.success);
		expect(strip(items[0]!.label)).toContain("deepseek");
		// Candidates are hollow (○), so the green filled dot unambiguously marks ready.
		expect(strip(items[1]!.label)).toContain("○");
		expect(strip(items[1]!.label)).not.toContain("●");
		expect(strip(items[1]!.label)).toContain("grok");
	});

	it("hides missing rows behind a trailing show-all item until revealed", () => {
		const hidden = buildProviderItems(entries, { showAll: false });
		expect(hidden.rows.map(row => row.provider)).toEqual(["deepseek", "grok"]);
		expect(hidden.hasHiddenMissing).toBe(true);
		expect(hidden.items.at(-1)?.value).toBe("show-all");

		const shown = buildProviderItems(entries, { showAll: true });
		expect(shown.rows.map(row => row.provider)).toEqual(["deepseek", "grok", "openai"]);
		expect(shown.hasHiddenMissing).toBe(false);
		expect(shown.items.some(item => item.value === "show-all")).toBe(false);
		expect(strip(shown.items[2]!.label)).toContain("○");
	});

	it("omits the show-all item when nothing is hidden", () => {
		const result = buildProviderItems(entries.slice(0, 2), { showAll: false });
		expect(result.hasHiddenMissing).toBe(false);
		expect(result.items.some(item => item.value === "show-all")).toBe(false);
	});

	it("carries origin detail and recommended model into the description, marking the preselected row", () => {
		const { items, rows } = buildProviderItems(entries, { showAll: true });
		expect(strip(items[0]!.description ?? "")).toContain("DEEPSEEK_API_KEY");
		expect(strip(items[0]!.description ?? "")).toContain("model: deepseek-v4-flash");
		expect(strip(items[0]!.description ?? "")).toContain("recommended");
		// Only one row carries the recommendation marker, and it is the preselected one.
		expect(strip(items[1]!.description ?? "")).not.toContain("recommended");
		expect(preselectedEntry(rows)?.provider).toBe("deepseek");
	});
});

describe("preselectedEntry", () => {
	it("prefers the first ready entry over later candidates", () => {
		const rows = [
			entry({ provider: "zai", status: "candidate", origin: { kind: "foreign-cli", detail: "~/.grok/auth.json" } }),
			entry({ provider: "xai", status: "ready", origin: { kind: "env", detail: "XAI_API_KEY" } }),
		];
		expect(preselectedEntry(rows)?.provider).toBe("xai");
	});

	it("falls back to the first candidate when nothing is ready", () => {
		const rows = [entry({ provider: "a" }), entry({ provider: "grok", status: "candidate" })];
		expect(preselectedEntry(rows)?.provider).toBe("grok");
	});

	it("returns undefined for an all-missing window", () => {
		expect(preselectedEntry([entry({ provider: "a" })])).toBeUndefined();
	});
});

describe("authKindForEntry routing", () => {
	const oauthIds = new Set(["anthropic", "xai"]);

	it("routes ready entries straight to verify", () => {
		expect(
			authKindForEntry(
				entry({ provider: "deepseek", status: "ready", origin: { kind: "env", detail: "K" } }),
				oauthIds,
			),
		).toBe("verify");
	});

	it("routes a foreign-cli store to the cli_proxy models.yml wiring", () => {
		expect(
			authKindForEntry(
				entry({
					provider: "grok",
					status: "candidate",
					origin: { kind: "foreign-cli", detail: "~/.grok/auth.json" },
				}),
				oauthIds,
			),
		).toBe("cli_proxy");
	});

	it("routes oauth-capable providers to the sign-in lifecycle and others to the masked key input", () => {
		expect(authKindForEntry(entry({ provider: "anthropic", status: "candidate" }), oauthIds)).toBe("oauth");
		expect(authKindForEntry(entry({ provider: "fireworks", status: "candidate" }), oauthIds)).toBe("api_key");
	});
});



describe("probeThenPersist ordering [GateFB2r]", () => {
	it("persists only after verify resolves true, and skips persist on failure", async () => {
		const order: string[] = [];
		const persisted = await probeThenPersist(
			"sk-test",
			async () => {
				order.push("verify");
				return true;
			},
			async () => {
				order.push("persist");
			},
		);
		expect(persisted).toBe(true);
		expect(order).toEqual( ["verify", "persist"]);

		order.length = 0;
		const failed = await probeThenPersist(
			"sk-dead",
			async () => {
				order.push("verify");
				return false;
			},
			async () => {
				order.push("persist");
			},
		);
		expect(failed).toBe(false);
		expect(order).toEqual(["verify"]); // persist must not run when verify fails
	});

	it("rejects empty keys outright", async () => {
		let verifyRan = false;
		const ok = await probeThenPersist("", async () => {
			verifyRan = true;
			return true;
		}, async () => {});
		expect(ok).toBe(false);
		expect(verifyRan).toBe(false);
	});
});
