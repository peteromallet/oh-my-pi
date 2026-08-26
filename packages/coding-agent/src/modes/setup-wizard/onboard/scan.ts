/**
 * Detect-first provider scan — PURE DATA, no TUI/rendering imports.
 *
 * Sweeps the provider registry and classifies each id as:
 * - `ready`     omp can already route it (stored auth, env var, or models.yml entry)
 * - `candidate` a foreign CLI credential store exists but omp has not wired it
 * - `missing`   nothing found
 *
 * Results are ranked Arnold-routes-first so the wizard's default preselection
 * matches how the agent actually routes. Only origins and variable NAMES are
 * reported — never secret values.
 *
 * All side-effectful inputs are injected via {@link ScanDeps}; use
 * {@link scanProvidersLive} (the default export) to build them from real
 * singletons.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export type ScanStatus = "ready" | "candidate" | "missing";

export interface ScanOrigin {
	kind: string;
	detail: string;
}

export interface ScanEntry {
	provider: string;
	status: ScanStatus;
	origin: ScanOrigin | null;
	defaultModel: string | null;
}

/** Structural slice of AuthStorage the scan needs (keeps tests fake-free of pi-ai). */
export interface ScanAuthSource {
	hasAuth(id: string): boolean;
	getCredentialOrigin(id: string): { kind: string; envVar?: string } | undefined;
}

export interface ScanDeps {
	registry: readonly { id: string }[];
	auth: ScanAuthSource;
	envApiKeyName(id: string): string | undefined;
	homeDir: string;
	/** Only entries WITH an apiKey count as ready — unverifiable rows must not claim an origin. */
	modelsYmlProviders?: readonly { id: string; hasApiKey: boolean }[];
}

/** Arnold's routing preference order — these surface first in the wizard. */
const ARNOLD_ORDER = [
	"deepseek",
	"openrouter",
	"xai",
	"anthropic",
	"kimi-code",
	"zai",
	"moonshot",
	"fireworks",
	"openai-codex",
	"grok",
] as const;

/**
 * Sensible first model per provider, grounded in the bundled catalog; used by
 * the wizard to preselect a default so Enter suffices. `null` when no opinion.
 * Exported for the onboard scenes' route-confirmation line.
 */
export const RECOMMENDED_MODELS: Record<string, string> = {
	deepseek: "deepseek-v4-flash",
	openrouter: "openrouter/auto",
	xai: "grok-code-fast-1",
	anthropic: "claude-sonnet-4-5",
	"kimi-code": "kimi-for-coding",
	zai: "glm-4.6",
	moonshot: "kimi-k2.5",
	fireworks: "deepseek-v4-flash",
	"openai-codex": "gpt-5.5",
};

/** Foreign CLI credential stores we can adopt but did not create. */
const FOREIGN_STORES = [
	{ provider: "openai-codex", segments: [".codex", "auth.json"] },
	{ provider: "grok", segments: [".grok", "auth.json"] },
] as const;

const ORIGIN_KIND_LABELS: Record<string, string> = {
	runtime: "runtime override",
	config: "config override",
	oauth: "omp login",
	api_key: "stored API key",
	fallback: "fallback resolver",
};

function classify(provider: string, deps: ScanDeps): ScanEntry {
	const origin = deps.auth.getCredentialOrigin(provider);
	if (deps.auth.hasAuth(provider)) {
		return {
			provider,
			status: "ready",
			origin: origin
				? {
						kind: origin.kind,
						detail:
							origin.kind === "env"
								? (origin.envVar ?? "environment variable")
								: (ORIGIN_KIND_LABELS[origin.kind] ?? origin.kind),
					}
				: null,
			defaultModel: RECOMMENDED_MODELS[provider] ?? null,
		};
	}
	const envName = deps.envApiKeyName(provider);
	if (envName) {
		return {
			provider,
			status: "ready",
			origin: { kind: "env", detail: envName },
			defaultModel: RECOMMENDED_MODELS[provider] ?? null,
		};
	}
	if (deps.modelsYmlProviders?.some(p => p.id === provider && p.hasApiKey)) {
		return {
			provider,
			status: "ready",
			origin: { kind: "models.yml", detail: "models.yml provider entry" },
			defaultModel: RECOMMENDED_MODELS[provider] ?? null,
		};
	}
	for (const store of FOREIGN_STORES) {
		if (store.provider === provider && existsSync(join(deps.homeDir, ...store.segments))) {
			return {
				provider,
				status: "candidate",
				origin: { kind: "foreign-cli", detail: `~/${store.segments.join("/")}` },
				defaultModel: RECOMMENDED_MODELS[provider] ?? null,
			};
		}
	}
	return { provider, status: "missing", origin: null, defaultModel: RECOMMENDED_MODELS[provider] ?? null };
}

/**
 * Rank ids Arnold-first, then remaining registry order, then any foreign-store
 * providers absent from the registry appended at their Arnold slot position.
 */
function rankProviders(deps: ScanDeps): string[] {
	const known = new Set<string>();
	for (const entry of deps.registry) known.add(entry.id);
	for (const store of FOREIGN_STORES) known.add(store.provider);
	const rest = [...known].filter(id => !(ARNOLD_ORDER as readonly string[]).includes(id));
	return [...ARNOLD_ORDER.filter(id => known.has(id)), ...rest];
}

export function scanProviders(deps: ScanDeps): ScanEntry[] {
	return rankProviders(deps).map(provider => classify(provider, deps));
}

/**
 * Convenience wrapper that builds {@link ScanDeps} from real singletons.
 * Heavy modules are imported lazily so this module's static graph stays free
 * of session/wizard/TUI dependencies.
 */
export default async function scanProvidersLive(): Promise<ScanEntry[]> {
	const [{ PROVIDER_REGISTRY, getEnvApiKeyName }, { discoverAuthStorage }, { ModelsConfigFile }, os] =
		await Promise.all([
			import("@oh-my-pi/pi-ai"),
			import("../../../sdk"),
			import("../../../config/models-config"),
			import("node:os"),
		]);
	const authStorage = await discoverAuthStorage();
	let modelsYmlProviders: { id: string; hasApiKey: boolean }[] | undefined;
	try {
		const config = await ModelsConfigFile.loadOrDefaultAsync();
		modelsYmlProviders = Object.entries(config.providers ?? {}).map(([id, provider]) => ({
			id,
			hasApiKey: Boolean(provider.apiKey),
		}));
	} catch {
		modelsYmlProviders = undefined;
	}
	return scanProviders({
		registry: PROVIDER_REGISTRY,
		auth: authStorage,
		// A provider's env-var NAME existing in the catalog proves nothing;
		// only report env-ready when the variable is actually set.
		envApiKeyName: (id) => {
			const name = getEnvApiKeyName(id);
			if (!name) return undefined;
			const value = Bun.env[name];
			return value && value.trim() !== "" ? name : undefined;
		},
		homeDir: os.homedir(),
		modelsYmlProviders,
	});
}
