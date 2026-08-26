/**
 * Per-agent visual identity: ASCII mark, display name, and gradient palette.
 *
 * The fork ships multiple agent faces over one omp runtime; `APP_NAME` keys
 * which identity renders in the splash, welcome sidebar, wizard chrome, and
 * outro. Unknown names fall back to the Oh My Pi face so third-party agents
 * inherit a sensible default instead of crashing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME, getAgentDir } from "@oh-my-pi/pi-utils";

export interface GradientPalette {
	/** Truecolor stops, bottom-left → top-right of the diagonal. */
	stops: ReadonlyArray<readonly [number, number, number]>;
	/** 256-color ramp for terminals without truecolor, same direction. */
	ramp256: readonly number[];
}

/** Paint one logo cell a fixed color (and optionally a different glyph),
 * bypassing the gradient. Coordinates index the standard-size `logo` grid;
 * callers scale them for enlarged renders. */
export interface LogoCellOverride {
	row: number;
	col: number;
	color: string;
	char?: string;
}

export interface AgentIdentity {
	/** Lowercase registry key; matches APP_NAME-style naming. */
	id: string;
	/** Human-facing name for chrome ("Astrid"), defaults to the id. */
	displayName?: string;
	/** Spaced-out brand line under the mark ("O h   M y   P i"). */
	tagline: string;
	/** Standard-size mark (welcome sidebar, wizard header, outro). */
	logo: readonly string[];
	gradient: GradientPalette;
	/** Fixed-color cells layered over the gradient (accents, eyes, sparks). */
	cellOverrides?: readonly LogoCellOverride[];
	/**
	 * Deep tint layer: theme color names -> hex, merged over the active
	 * theme at load time. Affects every themed surface (accents, borders,
	 * status colors), not just the logo.
	 */
	themeColors?: Readonly<Record<string, string>>;
}

/** Oh My Pi face — the upstream default (pink → violet → cyan → mint). */
export const PI_IDENTITY: AgentIdentity = {
	id: "oh-my-pi",
	displayName: "Oh My Pi",
	tagline: "O h   M y   P i",
	logo: [
		"▀██████████▀",
		" ╘██    ██  ",
		"  ██    ██  ",
		"  ██    ██  ",
		" ▄██▄  ▄██▄ ",
	],
	gradient: {
		stops: [
			[255, 92, 200], // hot pink
			[200, 110, 255], // violet
			[120, 130, 255], // periwinkle
			[60, 200, 255], // bright cyan
			[120, 255, 220], // mint
		],
		ramp256: [199, 171, 135, 99, 75, 51, 87],
	},
};

/**
 * Arnold face — raised fist in sunset oranges: burnt sienna rising to pale
 * gold along the diagonal.
 */
export const ARNOLD_IDENTITY: AgentIdentity = {
	id: "arnold",
	displayName: "Arnold",
	tagline: "a r n o l d",
	// Every line padded to the same width: renderers center each line
	// independently, so ragged widths would break the composition's offsets.
	logo: [
		"       ▄▟█▙     ",
		"     ▐█▘▀██▄   ",
		"    ▄████▛▀██▄  ",
		"  ▄████████████▄",
		" ▐██████████▀▀▀▘",
		" ████████▌      ",
		" █████▀▜▌       ",
		" ████▌ ▐▌       ",
		" ▀████▙▟▘       ",
		"   ▀███▘        ",
	],
	gradient: {
		stops: [
			[204, 85, 0], // burnt sienna
			[232, 125, 10], // copper
			[255, 145, 30], // orange
			[255, 185, 85], // amber
			[255, 219, 150], // pale gold
		],
		ramp256: [130, 166, 202, 208, 214, 220, 222],
	},
	// Glowing eyes: the two notches on the right edge of the fist, warm white
	// so they read as lit cutouts against the sunset ramp.
	themeColors: {
		accent: "#ffa028",
		borderAccent: "#ffb347",
	},
	cellOverrides: [
		{ row: 6, col: 6, color: "#fff3e0", char: "▘" },
		{ row: 6, col: 7, color: "#fff3e0", char: "▝" },
		{ row: 7, col: 6, color: "#fff3e0", char: "▖" },
		{ row: 7, col: 7, color: "#fff3e0", char: "▗" },
	],
};

const REGISTRY: Readonly<Record<string, AgentIdentity>> = {
	"oh-my-pi": PI_IDENTITY,
	pi: PI_IDENTITY,
	arnold: ARNOLD_IDENTITY,
};

/** Tolerant JSON shape for user-defined identities. */
interface CustomIdentityFile {
	displayName?: string;
	tagline?: string;
	logo?: readonly string[];
	gradient?: GradientPalette;
	cellOverrides?: readonly LogoCellOverride[];
}

/**
 * Load a user-defined identity from `<agentDir>/identities/<name>.json`.
 * Lets custom agent instances carry their own face without forking this
 * module: drop a JSON file, set OMP_AGENT_IDENTITY, done. Tolerant: anything
 * malformed or missing falls back to the caller's default.
 */
function loadCustomIdentity(name: string): AgentIdentity | undefined {
	try {
		const path = join(getAgentDir(), "identities", `${name}.json`);
		if (!existsSync(path)) return undefined;
		const raw = JSON.parse(readFileSync(path, "utf8")) as CustomIdentityFile;
		if (!Array.isArray(raw.logo) || raw.logo.length === 0 || !raw.logo.every(l => typeof l === "string")) {
			return undefined;
		}
		let logo = raw.logo;
		const widths = new Set(logo.map(l => l.length));
		if (widths.size > 1) {
			// Uniform width is mandatory: renderers center each line
			// independently, so ragged widths break the composition.
			const width = Math.max(...widths);
			logo = logo.map(line => line + " ".repeat(width - line.length));
		}
		return {
			id: name.toLowerCase(),
			displayName: raw.displayName,
			tagline: raw.tagline ?? name.replace(/(.)/g, "$1 ").trim(),
			logo,
			gradient: raw.gradient ?? PI_IDENTITY.gradient,
			cellOverrides: raw.cellOverrides,
		};
	} catch {
		return undefined;
	}
}

/**
 * Resolve an agent identity by name: built-in registry, then a user-defined
 * `<agentDir>/identities/<name>.json`, then the Oh My Pi fallback.
 */
export function getAgentIdentity(name: string = APP_NAME): AgentIdentity {
	const key = name.toLowerCase();
	return REGISTRY[key] ?? loadCustomIdentity(key) ?? PI_IDENTITY;
}

/**
 * The identity this runtime was branded with. Per-instance callers (the
 * Arnold launcher) set OMP_AGENT_IDENTITY to the agent's name before spawn so
 * each instance renders its own face.
 */
export const ACTIVE_IDENTITY: AgentIdentity = getAgentIdentity(Bun.env.OMP_AGENT_IDENTITY || APP_NAME);

/** Expand standard-grid overrides to a doubled render (each cell -> 2x2). */
export function scaleCellOverrides(
	overrides: readonly LogoCellOverride[] | undefined,
): LogoCellOverride[] | undefined {
	if (!overrides?.length) return undefined;
	const scaled: LogoCellOverride[] = [];
	for (const o of overrides) {
		for (const dy of [0, 1]) {
			for (const dx of [0, 1]) {
				scaled.push({ row: o.row * 2 + dy, col: o.col * 2 + dx, color: o.color, char: o.char });
			}
		}
	}
	return scaled;
}
