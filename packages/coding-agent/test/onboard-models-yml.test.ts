import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import {
	GROK_PROXY_DEFAULT_MODEL,
	spliceProvider,
	wireCliProxyModelsYml,
} from "../src/modes/setup-wizard/onboard/models-yml";

function readAgentModelsYml(agentDir: string): string {
	return fs.readFileSync(path.join(agentDir, "models.yml"), "utf-8");
}

describe("spliceProvider", () => {
	it("creates a providers section when the file is empty", () => {
		const merged = spliceProvider("", "grok", "  grok:\n    api: openai-completions");
		const parsed = YAML.parse(merged) as { providers: { grok: { api: string } } };
		expect(parsed.providers.grok.api).toBe("openai-completions");
	});

	it("appends a providers section to a comment-only file, preserving every byte", () => {
		const existing = "# my custom models\n# do not touch\n";
		const merged = spliceProvider(existing, "grok", "  grok:\n    api: openai-completions");
		expect(merged.startsWith(existing)).toBe(true);
		expect(YAML.parse(merged)).toBeTruthy();
	});

	it("inserts into an existing providers section without disturbing other content", () => {
		const existing = [
			"$schema: ./schema.json",
			"providers:",
			"  deepseek:",
			"    baseUrl: https://api.deepseek.com",
			"    # kept comment inside another provider",
			"    models:",
			"      - id: deepseek-chat",
			"",
			"# trailing top-level note",
		].join("\n");
		const merged = spliceProvider(existing, "grok", "  grok:\n    api: openai-completions");
		const parsed = YAML.parse(merged) as {
			$schema?: string;
			providers: Record<string, { api?: string; baseUrl?: string }>;
		};
		expect(parsed.$schema).toBe("./schema.json");
		expect(parsed.providers.grok?.api).toBe("openai-completions");
		expect(parsed.providers.deepseek?.baseUrl).toBe("https://api.deepseek.com");
		expect(merged).toContain("# kept comment inside another provider");
		expect(merged).toContain("# trailing top-level note");
		// Inserted as the first child of providers:
		expect(merged.indexOf("grok:")).toBeGreaterThan(merged.indexOf("providers:"));
		expect(merged.indexOf("grok:")).toBeLessThan(merged.indexOf("deepseek:"));
	});

	it("replaces an existing provider block in place, keeping siblings byte-identical", () => {
		const existing = [
			"providers:",
			"  grok:",
			"    baseUrl: https://old.example.com",
			"    api: anthropic-messages",
			"  deepseek:",
			"    baseUrl: https://api.deepseek.com",
		].join("\n");
		const merged = spliceProvider(existing, "grok", "  grok:\n    baseUrl: https://new.example.com");
		const parsed = YAML.parse(merged) as { providers: Record<string, { baseUrl: string }> };
		expect(parsed.providers.grok.baseUrl).toBe("https://new.example.com");
		expect(parsed.providers.deepseek.baseUrl).toBe("https://api.deepseek.com");
		const siblingLines = merged
			.split("\n")
			.filter(line => line.startsWith("  deepseek:") || line.includes("api.deepseek.com"));
		expect(siblingLines.length).toBe(2);
	});

	it("falls back to a YAML rewrite for anchor/flow-shaped providers headers instead of duplicating the key", () => {
		const existing = "providers: &base\n  deepseek:\n    baseUrl: https://api.deepseek.com\n";
		const merged = spliceProvider(existing, "grok", "  grok:\n    api: openai-completions");
		const parsed = YAML.parse(merged) as { providers: Record<string, { baseUrl?: string; api?: string }> };
		expect(Object.keys(parsed.providers).sort()).toEqual(["deepseek", "grok"]);
		expect(parsed.providers.deepseek.baseUrl).toBe("https://api.deepseek.com");
		expect(parsed.providers.grok.api).toBe("openai-completions");
	});

	it("is idempotent: splicing the same block twice changes nothing further", () => {
		const block = "  grok:\n    api: openai-completions";
		const once = spliceProvider("providers:\n  deepseek:\n    baseUrl: x\n", "grok", block);
		const twice = spliceProvider(once, "grok", block);
		expect(twice).toBe(once);
	});
});

describe("wireCliProxyModelsYml", () => {
	it("installs the token helper with a $HOME-expanded path and merges the command-backed entry", () => {
		using tempDir = TempDir.createSync("omp-onboard-wire-");
		const agentDir = path.join(tempDir.path(), "agent");
		const result = wireCliProxyModelsYml("grok", agentDir);
		expect(result.ok).toBe(true);

		const scriptPath = result.scriptPath!;
		expect(scriptPath.startsWith(tempDir.path())).toBe(true);
		expect(fs.existsSync(scriptPath)).toBe(true);
		const mode = fs.statSync(scriptPath).mode;
		expect(mode & 0o111).not.toBe(0);
		const script = fs.readFileSync(scriptPath, "utf-8");
		expect(script).toContain('os.path.expanduser("~")');
		expect(script).toContain(".grok");

		const parsed = YAML.parse(readAgentModelsYml(agentDir)) as {
			providers: Record<string, { apiKey: string; baseUrl: string }>;
		};
		const grok = parsed.providers.grok;
		expect(grok.apiKey).toBe(`!python3 ${scriptPath}`);
		expect(grok.baseUrl).toContain("cli-chat-proxy.grok.com");
		const modelIds = (parsed.providers.grok as unknown as { models: Array<{ id: string }> }).models.map(m => m.id);
		expect(modelIds[0]).toBe(GROK_PROXY_DEFAULT_MODEL);
	});

	it("preserves unrelated user content across the merge and is idempotent on re-wiring", () => {
		using tempDir = TempDir.createSync("omp-onboard-wire-idem-");
		const agentDir = path.join(tempDir.path(), "agent");
		fs.mkdirSync(agentDir, { recursive: true });
		const userContent = [
			"# user header comment",
			"providers:",
			"  custom-llama:",
			"    baseUrl: http://localhost:8080/v1",
			"    # user note",
			"    apiKey: sk-local-abcdefgh",
		].join("\n");
		fs.writeFileSync(path.join(agentDir, "models.yml"), `${userContent}\n`, "utf-8");

		const first = wireCliProxyModelsYml("grok", agentDir);
		expect(first.ok).toBe(true);
		const afterFirst = readAgentModelsYml(agentDir);
		expect(afterFirst).toContain("# user header comment");
		expect(afterFirst).toContain("# user note");
		const parsedFirst = YAML.parse(afterFirst) as { providers: Record<string, unknown> };
		expect(Object.keys(parsedFirst.providers).sort()).toEqual(["custom-llama", "grok"]);

		const second = wireCliProxyModelsYml("grok", agentDir);
		expect(second.ok).toBe(true);
		expect(readAgentModelsYml(agentDir)).toBe(afterFirst);
	});

	it("leaves no temp files behind (atomic rename)", () => {
		using tempDir = TempDir.createSync("omp-onboard-wire-tmp-");
		const agentDir = path.join(tempDir.path(), "agent");
		wireCliProxyModelsYml("grok", agentDir);
		const leftovers = fs.readdirSync(agentDir).filter(name => name.includes(".omp-onboard-tmp-"));
		expect(leftovers).toEqual([]);
	});

	it("refuses providers without a cli_proxy template", () => {
		using tempDir = TempDir.createSync("omp-onboard-wire-refuse-");
		const result = wireCliProxyModelsYml("deepseek", tempDir.path());
		expect(result.ok).toBe(false);
		expect(result.error).toContain("only 'grok' is supported");
	});
});
