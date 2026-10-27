/**
 * Per-agent visual identity: ASCII mark, display name, and gradient palette.
 *
 * The fork ships multiple agent faces over one omp runtime; `APP_NAME` keys
 * which identity renders in the splash, welcome sidebar, wizard chrome, and
 * outro. Unknown names fall back to the Oh My Pi face so third-party agents
 * inherit a sensible default instead of crashing.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { APP_NAME, getAgentDir, isRecord, logger } from "@oh-my-pi/pi-utils";

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
	/** One-cell mark for compact status/title chrome ("A" for Astrid). */
	statusIcon?: string;
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
	statusIcon: "π",
	tagline: "O h   M y   P i",
	logo: ["▀██████████▀", " ╘██    ██  ", "  ██    ██  ", "  ██    ██  ", " ▄██▄  ▄██▄ "],
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
	statusIcon: "A",
	tagline: "a r n o l d",
	// Every line padded to the same width: renderers center each line
	// independently, so ragged widths would break the composition's offsets.
	logo: [
		"       ▄▟█▙     ",
		"     ▐█▘▀██▄    ",
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

function isColor(value: unknown): value is string {
	return typeof value === "string" && Bun.color(value, "hex") !== null;
}

function isDisplayText(value: unknown): value is string {
	return typeof value === "string" && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function isSingleGlyph(value: unknown): value is string {
	return isDisplayText(value) && Array.from(value).length === 1;
}

function isColorByte(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

function isGradient(value: unknown): value is GradientPalette {
	return (
		isRecord(value) &&
		Array.isArray(value.stops) &&
		value.stops.length >= 2 &&
		value.stops.every(stop => Array.isArray(stop) && stop.length === 3 && stop.every(isColorByte)) &&
		Array.isArray(value.ramp256) &&
		value.ramp256.length > 0 &&
		value.ramp256.every(isColorByte)
	);
}

/** Both identity sources share validation; legacy home files need no id. */
function parseIdentity(raw: unknown, name: string, requireId: boolean): AgentIdentity | undefined {
	if (!isRecord(raw) || (requireId && raw.id !== name)) return undefined;
	if (!Array.isArray(raw.logo) || raw.logo.length === 0 || !raw.logo.every(isDisplayText)) {
		return undefined;
	}
	// Uniform width is mandatory: renderers center each line independently.
	const width = raw.logo.reduce((max, line) => Math.max(max, line.length), 0);
	if (width === 0) return undefined;
	const logo: string[] = raw.logo.map(line => line.padEnd(width));
	const cellOverrides: LogoCellOverride[] = [];
	if (Array.isArray(raw.cellOverrides)) {
		for (const cell of raw.cellOverrides) {
			if (
				!isRecord(cell) ||
				typeof cell.row !== "number" ||
				!Number.isInteger(cell.row) ||
				cell.row < 0 ||
				cell.row >= logo.length ||
				typeof cell.col !== "number" ||
				!Number.isInteger(cell.col) ||
				cell.col < 0 ||
				cell.col >= width ||
				!isColor(cell.color) ||
				(cell.char !== undefined && (!isDisplayText(cell.char) || cell.char.length !== 1))
			) {
				continue;
			}
			cellOverrides.push({ row: cell.row, col: cell.col, color: cell.color, char: cell.char });
		}
	}
	// Theme values must be literal colors, not references into an arbitrary
	// active theme's vars (which could be missing or circular).
	const themeColors = isRecord(raw.themeColors)
		? Object.fromEntries(
				Object.entries(raw.themeColors).filter(
					(entry): entry is [string, string] => entry[1] === "" || (isColor(entry[1]) && entry[1].startsWith("#")),
				),
			)
		: undefined;
	return {
		id: name,
		displayName: isDisplayText(raw.displayName) ? raw.displayName : undefined,
		statusIcon: isSingleGlyph(raw.statusIcon) ? raw.statusIcon : undefined,
		tagline: isDisplayText(raw.tagline) ? raw.tagline : name.replace(/(.)/g, "$1 ").trim(),
		logo,
		gradient: isGradient(raw.gradient) ? raw.gradient : PI_IDENTITY.gradient,
		cellOverrides: cellOverrides.length > 0 ? cellOverrides : undefined,
		themeColors,
	};
}

/** Malformed or unavailable files fall through to the next identity source. */
function loadIdentityFile(file: string, name: string, requireId = false): AgentIdentity | undefined {
	try {
		if (!fs.statSync(file).isFile()) return undefined;
		const identity = parseIdentity(JSON.parse(fs.readFileSync(file, "utf8")), name, requireId);
		if (!identity) logger.debug("Ignoring invalid agent identity file", { path: file, identity: name });
		return identity;
	} catch (error) {
		logger.debug("Unable to load agent identity file", { path: file, identity: name, error: String(error) });
		return undefined;
	}
}

/**
 * Resolve an identity: built-in registry, OMP_AGENT_IDENTITY_FILE (absolute
 * regular file with a matching lowercase id), <agentDir>/identities/<name>.json,
 * then the Oh My Pi fallback. Built-ins cannot be overridden by either file.
 */
export function getAgentIdentity(name: string = APP_NAME): AgentIdentity {
	const key = name.toLowerCase();
	if (Object.hasOwn(REGISTRY, key)) return REGISTRY[key];
	const file = Bun.env.OMP_AGENT_IDENTITY_FILE;
	if (file) {
		if (path.isAbsolute(file)) {
			const identity = loadIdentityFile(file, key, true);
			if (identity) return identity;
		} else {
			logger.debug("Ignoring relative agent identity file", { path: file, identity: key });
		}
	}
	return loadIdentityFile(path.join(getAgentDir(), "identities", `${key}.json`), key) ?? PI_IDENTITY;
}

/**
 * The identity this runtime was branded with. Per-instance callers (the
 * Arnold launcher) set OMP_AGENT_IDENTITY to the agent's name before spawn so
 * each instance renders its own face.
 */
export const ACTIVE_IDENTITY: AgentIdentity = getAgentIdentity(Bun.env.OMP_AGENT_IDENTITY || APP_NAME);

/** Expand standard-grid overrides to a doubled render (each cell -> 2x2). */
export function scaleCellOverrides(overrides: readonly LogoCellOverride[] | undefined): LogoCellOverride[] | undefined {
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
