import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";
import { commands } from "../src/cli-commands";
import { ONBOARD_EXIT_CODE, ONBOARD_GUARD_MESSAGE, runOnboard } from "../src/commands/onboard";
import { type ScanDeps, scanProviders } from "../src/modes/setup-wizard/onboard/scan";

const ONBOARD_HELP_DESCRIPTION = "detect-first provider onboarding (differs from setup: finds what you already have)";

/** Scrambled registry order proves the Arnold-first reranking actually sorts. */
const SCRAMBLED_IDS = [
	"worktree",
	"zai",
	"openai",
	"kimi-code",
	"anthropic",
	"moonshot",
	"deepseek",
	"xai",
	"fireworks",
	"openrouter",
	"openai-codex",
];

interface DepsOverrides {
	hasAuth?: (id: string) => boolean;
	getCredentialOrigin?: (id: string) => { kind: string; envVar?: string } | undefined;
	envApiKeyName?: (id: string) => string | undefined;
	homeDir?: string;
	modelsYmlProviders?: { id: string; hasApiKey: boolean }[];
}

function makeDeps(overrides: DepsOverrides = {}, registryIds: string[] = SCRAMBLED_IDS): ScanDeps {
	return {
		registry: registryIds.map(id => ({ id })),
		auth: {
			hasAuth: overrides.hasAuth ?? (() => false),
			getCredentialOrigin: overrides.getCredentialOrigin ?? (() => undefined),
		},
		envApiKeyName: overrides.envApiKeyName ?? (() => undefined),
		homeDir: overrides.homeDir ?? "/nonexistent-home",
		modelsYmlProviders: overrides.modelsYmlProviders,
	};
}

describe("scanProviders ranking", () => {
	it("orders Arnold routes first, then remaining registry order", () => {
		const entries = scanProviders(makeDeps());
		const providers = entries.map(entry => entry.provider);
		const arnoldPresent = [
			"deepseek",
			"openrouter",
			"xai",
			"anthropic",
			"kimi-code",
			"zai",
			"moonshot",
			"fireworks",
			"openai-codex",
		].filter(id => providers.includes(id));
		expect(providers.slice(0, arnoldPresent.length)).toEqual(arnoldPresent);
		expect(providers.indexOf("deepseek")).toBeLessThan(providers.indexOf("zai"));
		expect(providers.indexOf("openrouter")).toBeLessThan(providers.indexOf("anthropic"));
		// Non-Arnold ids keep registry order behind the Arnold block
		// (grok rides in the Arnold block even though it is foreign-store-only).
		expect(providers.slice(-2)).toEqual(["worktree", "openai"]);
		expect(providers.indexOf("grok")).toBeLessThan(providers.indexOf("worktree"));
	});

	it("includes foreign-store providers absent from the registry", () => {
		using tempDir = TempDir.createSync("omp-onboard-scan-");
		fs.mkdirSync(path.join(tempDir.path(), ".grok"), { recursive: true });
		fs.writeFileSync(path.join(tempDir.path(), ".grok", "auth.json"), "{}");
		const entries = scanProviders(makeDeps({ homeDir: tempDir.path() }, ["deepseek"]));
		expect(entries.map(entry => entry.provider)).toEqual(["deepseek", "openai-codex", "grok"]);
		expect(entries[2].status).toBe("candidate");
	});
});

describe("scanProviders status logic", () => {
	it("reports stored auth as ready with its credential-origin kind", () => {
		const entries = scanProviders(
			makeDeps({
				hasAuth: id => id === "deepseek",
				getCredentialOrigin: id => (id === "deepseek" ? { kind: "oauth" } : undefined),
			}),
		);
		const deepseek = entries.find(entry => entry.provider === "deepseek");
		expect(deepseek?.status).toBe("ready");
		expect(deepseek?.origin).toEqual({ kind: "oauth", detail: "omp login" });
	});

	it("reports env-var providers as ready with the variable NAME, never a value", () => {
		const entries = scanProviders(
			makeDeps({
				envApiKeyName: id => (id === "openrouter" ? "OPENROUTER_API_KEY" : undefined),
			}),
		);
		const openrouter = entries.find(entry => entry.provider === "openrouter");
		expect(openrouter?.status).toBe("ready");
		expect(openrouter?.origin).toEqual({ kind: "env", detail: "OPENROUTER_API_KEY" });
	});

	it("reports env origins with their backing variable name when AuthStorage classifies them", () => {
		const entries = scanProviders(
			makeDeps({
				hasAuth: id => id === "xai",
				getCredentialOrigin: id => (id === "xai" ? { kind: "env", envVar: "XAI_OAUTH_TOKEN" } : undefined),
			}),
		);
		const xai = entries.find(entry => entry.provider === "xai");
		expect(xai?.origin).toEqual({ kind: "env", detail: "XAI_OAUTH_TOKEN" });
	});

	it("reports models.yml providers WITH an apiKey as ready", () => {
		const entries = scanProviders(makeDeps({ modelsYmlProviders: [{ id: "fireworks", hasApiKey: true }] }));
		const fireworks = entries.find(entry => entry.provider === "fireworks");
		expect(fireworks?.status).toBe("ready");
		expect(fireworks?.origin).toEqual({ kind: "models.yml", detail: "models.yml provider entry" });
	});

	it("does NOT report models.yml providers without an apiKey as ready", () => {
		const entries = scanProviders(
			makeDeps({ modelsYmlProviders: [{ id: "fireworks", hasApiKey: false }] }),
		);
		const fireworks = entries.find(entry => entry.provider === "fireworks");
		expect(fireworks?.status).toBe("missing");
		expect(fireworks?.origin).toBeNull();
	});

	it("prefers stored auth over env and models.yml signals", () => {
		const entries = scanProviders(
			makeDeps({
				hasAuth: id => id === "anthropic",
				getCredentialOrigin: id => (id === "anthropic" ? { kind: "api_key" } : undefined),
				envApiKeyName: () => "ANTHROPIC_API_KEY",
				modelsYmlProviders: [{ id: "anthropic", hasApiKey: true }],
			}),
		);
		const anthropic = entries.find(entry => entry.provider === "anthropic");
		expect(anthropic?.origin).toEqual({ kind: "api_key", detail: "stored API key" });
	});

	it("marks unwired foreign CLI stores as candidates with tilde paths", () => {
		using tempDir = TempDir.createSync("omp-onboard-scan-");
		for (const dir of [".codex", ".grok"]) {
			fs.mkdirSync(path.join(tempDir.path(), dir), { recursive: true });
			fs.writeFileSync(path.join(tempDir.path(), dir, "auth.json"), '{"token": "sk-foreign-secret"}');
		}
		const entries = scanProviders(makeDeps({ homeDir: tempDir.path() }));
		const codex = entries.find(entry => entry.provider === "openai-codex");
		const grok = entries.find(entry => entry.provider === "grok");
		expect(codex?.status).toBe("candidate");
		expect(codex?.origin).toEqual({ kind: "foreign-cli", detail: "~/.codex/auth.json" });
		expect(grok?.status).toBe("candidate");
		expect(grok?.origin).toEqual({ kind: "foreign-cli", detail: "~/.grok/auth.json" });
	});

	it("does not mark wired foreign-store providers as candidates", () => {
		using tempDir = TempDir.createSync("omp-onboard-scan-");
		fs.mkdirSync(path.join(tempDir.path(), ".codex"), { recursive: true });
		fs.writeFileSync(path.join(tempDir.path(), ".codex", "auth.json"), "{}");
		const entries = scanProviders(
			makeDeps({
				homeDir: tempDir.path(),
				hasAuth: id => id === "openai-codex",
				getCredentialOrigin: id => (id === "openai-codex" ? { kind: "oauth" } : undefined),
			}),
		);
		const codex = entries.find(entry => entry.provider === "openai-codex");
		expect(codex?.status).toBe("ready");
		expect(codex?.origin?.kind).not.toBe("foreign-cli");
	});

	it("reports unconfigured providers as missing with null origin", () => {
		const entries = scanProviders(makeDeps({}, ["deepseek"]));
		expect(entries[0].status).toBe("missing");
		expect(entries[0].origin).toBeNull();
		expect(entries[0]).toEqual({
			provider: "deepseek",
			status: "missing",
			origin: null,
			defaultModel: expect.any(String),
		});
	});
});

describe("scanProviders hygiene", () => {
	it("never leaks secret values through serialized output", () => {
		using tempDir = TempDir.createSync("omp-onboard-scan-");
		fs.mkdirSync(path.join(tempDir.path(), ".codex"), { recursive: true });
		fs.writeFileSync(path.join(tempDir.path(), ".codex", "auth.json"), '{"OPENAI_API_KEY": "sk-leak-me-please"}');
		const entries = scanProviders(
			makeDeps({
				homeDir: tempDir.path(),
				envApiKeyName: id => (id === "deepseek" ? "DEEPSEEK_API_KEY" : undefined),
			}),
		);
		const serialized = JSON.stringify(entries);
		expect(serialized).not.toContain("sk-leak-me-please");
		expect(serialized).toContain("DEEPSEEK_API_KEY");
	});

	it("is null-safe on defaultModel for providers without a recommendation", () => {
		const entries = scanProviders(
			makeDeps(
				{
					envApiKeyName: id => (id === "openai" || id === "deepseek" ? `${id.toUpperCase()}_KEY` : undefined),
				},
				["openai", "deepseek"],
			),
		);
		const openai = entries.find(entry => entry.provider === "openai");
		const deepseek = entries.find(entry => entry.provider === "deepseek");
		expect(openai?.defaultModel).toBeNull();
		expect(deepseek?.defaultModel).toEqual(expect.any(String));
	});
});

describe("onboard command registration", () => {
	it("registers beside setup with matching help metadata", async () => {
		const entry = commands.find(command => command.name === "onboard");
		expect(entry?.help?.description).toBe(ONBOARD_HELP_DESCRIPTION);
		const ctor = await entry?.load();
		expect(ctor?.description).toBe(ONBOARD_HELP_DESCRIPTION);
	});
});

describe("onboard non-TTY guard", () => {
	const scriptPath = path.join(import.meta.dir, "onboard-guard-probe.tmp.ts");
	const onboardEntry = path.join(import.meta.dir, "..", "src", "commands", "onboard.ts");

	afterAll(() => {
		fs.rmSync(scriptPath, { force: true });
	});

	it("prints guidance, exits 2, and keeps TUI/wizard modules unloaded", async () => {
		fs.writeFileSync(
			scriptPath,
			`
const probed: string[] = [];
Bun.plugin({
	name: "b1-tui-probe",
	setup(build) {
		build.onLoad({ filter: /(pi-tui|setup-wizard|interactive-mode)/ }, args => {
			probed.push(args.path);
			return { contents: "export {};", loader: "js" };
		});
	},
});
const mod = await import(${JSON.stringify(onboardEntry)});
async function attempt(deps: Record<string, unknown>): Promise<string> {
	let stderrText = "";
	let exitCode: number | undefined;
	try {
		await mod.runOnboard({
			writeStderr: (text: string) => { stderrText += text; },
			exit: (code: number) => { exitCode = code; throw new Error("__guard_exit__"); },
			...deps,
		});
	} catch {}
	if (exitCode !== ${ONBOARD_EXIT_CODE}) throw new Error("expected exit ${ONBOARD_EXIT_CODE}, got " + exitCode);
	return stderrText;
}
const stdinResult = await attempt({ stdinIsTTY: false, stdoutIsTTY: true });
const stdoutResult = await attempt({ stdinIsTTY: true, stdoutIsTTY: false });
console.log(JSON.stringify({
	stdinResult,
	stdoutResult,
	tuiProbed: probed.filter(p => p.includes("pi-tui")).length,
	wizardProbed: probed.filter(p => p.includes("setup-wizard")).length,
}));
`,
		);
		const proc = Bun.spawnSync(["bun", scriptPath], { cwd: import.meta.dir });
		expect(proc.exitCode).toBe(0);
		const result = JSON.parse(new TextDecoder().decode(proc.stdout)) as {
			stdinResult: string;
			stdoutResult: string;
			tuiProbed: number;
			wizardProbed: number;
		};
		expect(result.stdinResult).toBe(ONBOARD_GUARD_MESSAGE);
		expect(result.stdoutResult).toBe(ONBOARD_GUARD_MESSAGE);
		expect(result.tuiProbed).toBe(0);
		expect(result.wizardProbed).toBe(0);
	});
});

describe("onboard guard constants (in-process)", () => {
	it("exposes the exact headless message and exit code", () => {
		expect(ONBOARD_GUARD_MESSAGE).toBe("omp onboard needs an interactive terminal.\n");
		expect(ONBOARD_EXIT_CODE).toBe(2);
	});

	it("runOnboard honors injected stderr and exit without touching process state", async () => {
		let stderrText = "";
		let exitCode = 0;
		await expect(
			runOnboard({
				stdinIsTTY: false,
				stdoutIsTTY: false,
				writeStderr: text => {
					stderrText += text;
				},
				exit: code => {
					exitCode = code;
					throw new Error("__guard_exit__");
				},
			}),
		).rejects.toThrow("__guard_exit__");
		expect(stderrText).toBe("omp onboard needs an interactive terminal.\n");
		expect(exitCode).toBe(2);
	});
});
