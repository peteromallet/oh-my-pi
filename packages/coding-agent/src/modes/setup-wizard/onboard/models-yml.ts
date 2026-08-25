/**
 * cli_proxy wiring — grok-style command-backed provider entry in models.yml.
 *
 * Port of Arnold's `agentbox/onboarding/wire.py` (`wire_cli_proxy` and its
 * helpers), preserving the exact semantics: textual splice of one provider
 * block that keeps every other byte of the file (comments included), full-YAML
 * rewrite fallback only for anchor/flow-shaped `providers:` headers, atomic
 * write via rename in the destination directory, `$HOME`-expanded helper path,
 * and a post-write parse validation. Do not "simplify" the splice — it is the
 * merge-preservation contract.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { YAML } from "bun";

/** Token-refresh helper installed into the agent dir; referenced by models.yml
 *  as `apiKey: "!python3 <path>"`. Mirrors docs/omp-setup/grok-token.py with the
 *  hardcoded home path replaced by a runtime expanduser lookup. */
const GROK_TOKEN_SCRIPT = `#!/usr/bin/env python3
"""Print the current x.ai bearer token for the grok CLI proxy, refreshing via
OIDC when near expiry. Used as a command-backed apiKey in models.yml
(apiKey: "!python3 .../grok-token.py"). Writes refreshed tokens back to
~/.grok/auth.json so the grok CLI and omp stay in sync.
"""
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

AUTH_PATH = os.path.join(os.path.expanduser("~"), ".grok", "auth.json")
ISSUER_MARKER = "auth.x.ai"
REFRESH_MARGIN_SECONDS = 300
DEFAULT_EXPIRES_IN = 21600


def load_auth():
    with open(AUTH_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def find_entry(auth):
    for key, entry in auth.items():
        if ISSUER_MARKER in key and isinstance(entry, dict):
            return key, entry
    raise KeyError(f"no {ISSUER_MARKER} entry in {AUTH_PATH}")


def expires_at_ts(entry):
    raw = entry.get("expires_at")
    if not raw:
        return 0
    return datetime.datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()


def refresh(entry):
    body = urllib.parse.urlencode(
        {
            "grant_type": "refresh_token",
            "refresh_token": entry["refresh_token"],
            "client_id": entry["oidc_client_id"],
        }
    ).encode()
    req = urllib.request.Request(
        entry["oidc_issuer"] + "/oauth2/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        result = json.loads(resp.read())
    entry["key"] = result["access_token"]
    if result.get("refresh_token"):
        entry["refresh_token"] = result["refresh_token"]
    entry["expires_at"] = (
        datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(seconds=result.get("expires_in", DEFAULT_EXPIRES_IN))
    ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return result["access_token"]


def main():
    auth = load_auth()
    _, entry = find_entry(auth)
    key = entry.get("key")
    if key and expires_at_ts(entry) > datetime.datetime.now(datetime.timezone.utc).timestamp() + REFRESH_MARGIN_SECONDS:
        sys.stdout.write(key)
        return
    new_key = refresh(entry)
    with open(AUTH_PATH, "w", encoding="utf-8") as fh:
        json.dump(auth, fh, indent=2)
    sys.stdout.write(new_key)


if __name__ == "__main__":
    main()
`;

const GROK_ENTRY_TEMPLATE = {
	baseUrl: "https://cli-chat-proxy.grok.com/v1",
	api: "openai-completions",
	headers: {
		"X-XAI-Token-Auth": "xai-grok-cli",
		"x-grok-client-version": "1.0.5",
		"x-grok-client-identifier": "grok-shell",
	},
	models: [
		{
			id: "grok-4.6",
			name: "Grok 4.6",
			contextWindow: 500000,
			maxTokens: 32768,
			reasoning: true,
			thinking: { mode: "effort", efforts: ["low", "medium", "high", "xhigh"], defaultLevel: "high" },
			compat: {
				supportsDeveloperRole: true,
				supportsReasoningEffort: true,
				reasoningContentField: "reasoning_content",
			},
		},
		{
			id: "grok-4.5",
			name: "Grok 4.5",
			contextWindow: 500000,
			maxTokens: 32768,
			reasoning: true,
			thinking: { mode: "effort", efforts: ["low", "medium", "high", "xhigh"], defaultLevel: "high" },
			compat: {
				supportsDeveloperRole: true,
				supportsReasoningEffort: true,
				reasoningContentField: "reasoning_content",
			},
		},
	],
} as const;

/** Default model id advertised for the wired grok route. */
export const GROK_PROXY_DEFAULT_MODEL = "grok-4.6";

function installGrokTokenScript(agentDir: string): string {
	mkdirSync(agentDir, { recursive: true });
	const scriptPath = join(agentDir, "grok-token.py");
	writeFileSync(scriptPath, GROK_TOKEN_SCRIPT, { encoding: "utf-8", mode: 0o755 });
	return scriptPath;
}

/** Plain-safe YAML scalars stay unquoted; anything else (leading `!`, URLs
 *  with reserved chars, bool/null lookalikes) is emitted double-quoted. */
function yamlScalar(value: unknown): string {
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (
		typeof value === "string" &&
		/^[A-Za-z0-9_./:+-]+$/.test(value) &&
		!/^(?:true|false|null|yes|no|on|off|~)$/i.test(value)
	) {
		return value;
	}
	return JSON.stringify(value);
}

/** Render one mapping/list node as block-style YAML lines at `indent`. */
function yamlBlockLines(key: string, value: unknown, indent: string, lines: string[]): void {
	if (Array.isArray(value)) {
		lines.push(`${indent}${key}:`);
		for (const item of value) {
			if (typeof item !== "object" || item === null) {
				lines.push(`${indent}  - ${yamlScalar(item)}`);
				continue;
			}
			const entries = Object.entries(item as Record<string, unknown>);
			const [firstKey, firstValue] = entries[0]!;
			lines.push(`${indent}  - ${firstKey}: ${yamlScalar(firstValue)}`);
			for (const [k, v] of entries.slice(1)) {
				yamlBlockLines(k, v, `${indent}    `, lines);
			}
		}
		return;
	}
	if (typeof value === "object" && value !== null) {
		lines.push(`${indent}${key}:`);
		for (const [k, v] of Object.entries(value)) {
			yamlBlockLines(k, v, `${indent}  `, lines);
		}
		return;
	}
	lines.push(`${indent}${key}: ${yamlScalar(value)}`);
}

/** Render one provider entry as an indented two-space YAML block. */
function renderProviderBlock(providerId: string, entry: Record<string, unknown>): string {
	const lines: string[] = [`${providerId}:`];
	for (const [key, value] of Object.entries(entry)) {
		yamlBlockLines(key, value, "  ", lines);
	}
	return lines.map(line => `  ${line}`).join("\n");
}

function rewriteViaYaml(text: string, providerId: string, block: string): string {
	const data = (YAML.parse(text) ?? {}) as Record<string, unknown>;
	const providers = data.providers;
	if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
		throw new Error("models.yml has non-mapping providers section; refusing to rewrite");
	}
	const entry = YAML.parse(block) as Record<string, Record<string, unknown>>;
	(providers as Record<string, unknown>)[providerId] = entry[providerId];
	return YAML.stringify(data);
}

/**
 * Textually insert/replace one provider block, preserving all other bytes.
 *
 * Falls back to a full YAML parse/stringify rewrite when the top-level
 * `providers:` header carries anchors or flow tokens — byte-preserving
 * splicing cannot represent those shapes, and appending would create a
 * duplicate key that silently drops user content under last-wins mapping
 * resolution.
 */
export function spliceProvider(text: string, providerId: string, block: string): string {
	const lines = text.split("\n");
	const headerRe = /^providers:\s*(#.*)?$/;
	const exoticHeaderRe = /^providers:\s*(?!\s*(?:#.*)?$).+$/;
	const keyRe = new RegExp(`^  ${providerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(#.*)?$`);
	const siblingRe = /^ {2}\S/;

	let headerIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (headerRe.test(lines[i] ?? "")) {
			headerIdx = i;
			break;
		}
	}

	if (headerIdx === -1 && lines.some(line => exoticHeaderRe.test(line))) {
		return rewriteViaYaml(text, providerId, block);
	}

	const blockLines = block.split("\n");

	if (headerIdx === -1) {
		const prefix = text.length === 0 ? "" : text.endsWith("\n") ? "" : "\n";
		return `${text}${prefix}providers:\n${blockLines.join("\n")}\n`;
	}

	// End of the top-level `providers:` section = next non-empty column-0 line.
	let end = lines.length;
	for (let i = headerIdx + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.length > 0 && !/\s/.test(line[0] ?? "")) {
			end = i;
			break;
		}
	}

	// Existing provider block within the section?
	let start = -1;
	for (let i = headerIdx + 1; i < end; i++) {
		if (keyRe.test(lines[i] ?? "")) {
			start = i;
			break;
		}
	}
	if (start !== -1) {
		let blockEnd = end;
		for (let i = start + 1; i < end; i++) {
			if (siblingRe.test(lines[i] ?? "")) {
				blockEnd = i;
				break;
			}
		}
		return [...lines.slice(0, start), ...blockLines, ...lines.slice(blockEnd)].join("\n");
	}

	// Insert as first child right after the header.
	return [...lines.slice(0, headerIdx + 1), ...blockLines, ...lines.slice(headerIdx + 1)].join("\n");
}

function atomicWrite(path: string, content: string): void {
	const parent = join(path, "..");
	mkdirSync(parent, { recursive: true });
	const tmpPath = join(parent, `.omp-onboard-tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
	try {
		writeFileSync(tmpPath, content, "utf-8");
		try {
			chmodSync(tmpPath, statSync(path).mode);
		} catch {
			chmodSync(tmpPath, 0o600);
		}
		renameSync(tmpPath, path);
	} catch (error) {
		try {
			unlinkSync(tmpPath);
		} catch {
			// temp file never landed — nothing to clean up
		}
		throw error;
	}
}

export interface CliProxyWireResult {
	ok: boolean;
	/** Absolute helper-script path ($HOME-expanded) when installed. */
	scriptPath?: string;
	error?: string;
}

/**
 * Merge the command-backed grok provider entry into `<agentDir>/models.yml`,
 * exactly like Arnold's `wire_cli_proxy`: install the token-refresh helper
 * into the agent dir, splice the provider block byte-preservingly, atomically
 * replace the file, then validate the merged document still parses and keeps
 * the command-backed apiKey.
 */
export function wireCliProxyModelsYml(providerId: string, agentDir: string): CliProxyWireResult {
	if (providerId !== "grok") {
		return { ok: false, error: `no cli_proxy wiring template for ${providerId}; only 'grok' is supported` };
	}

	const scriptPath = installGrokTokenScript(agentDir);
	const entry: Record<string, unknown> = { ...(GROK_ENTRY_TEMPLATE as Record<string, unknown>) };
	// apiKey ordering first, mirroring the fork docs layout.
	const ordered: Record<string, unknown> = {
		baseUrl: entry.baseUrl,
		api: entry.api,
		apiKey: `!python3 ${scriptPath}`,
	};
	for (const [key, value] of Object.entries(entry)) {
		if (key !== "baseUrl" && key !== "api") ordered[key] = value;
	}

	const modelsYml = join(agentDir, "models.yml");
	let existing = "";
	try {
		existing = readFileSync(modelsYml, "utf-8");
	} catch {
		existing = "";
	}
	let updated: string;
	try {
		updated = spliceProvider(existing, providerId, renderProviderBlock(providerId, ordered));
	} catch (error) {
		return { ok: false, scriptPath, error: error instanceof Error ? error.message : String(error) };
	}
	atomicWrite(modelsYml, updated);

	// Round-trip sanity: the merged file must still parse and keep the cmd key.
	try {
		const merged = YAML.parse(readFileSync(modelsYml, "utf-8")) as {
			providers?: Record<string, { apiKey?: string }>;
		} | null;
		const ok =
			typeof merged === "object" &&
			merged !== null &&
			typeof (merged.providers?.[providerId]?.apiKey ?? "") === "string" &&
			(merged.providers?.[providerId]?.apiKey ?? "").startsWith("!python3 ");
		return ok
			? { ok: true, scriptPath }
			: { ok: false, scriptPath, error: "merged models.yml failed post-write validation" };
	} catch (error) {
		return { ok: false, scriptPath, error: error instanceof Error ? error.message : String(error) };
	}
}
