/**
 * Per-agent visual identity: ASCII mark, display name, and gradient palette.
 *
 * The fork ships multiple agent faces over one omp runtime; `APP_NAME` keys
 * which identity renders in the splash, welcome sidebar, wizard chrome, and
 * outro. Unknown names fall back to the Oh My Pi face so third-party agents
 * inherit a sensible default instead of crashing.
 */
import { APP_NAME } from "@oh-my-pi/pi-utils";

export interface GradientPalette {
	/** Truecolor stops, bottom-left → top-right of the diagonal. */
	stops: ReadonlyArray<readonly [number, number, number]>;
	/** 256-color ramp for terminals without truecolor, same direction. */
	ramp256: readonly number[];
}

export interface AgentIdentity {
	/** Lowercase registry key; matches APP_NAME-style naming. */
	id: string;
	/** Spaced-out brand line under the mark ("O h   M y   P i"). */
	tagline: string;
	/** Standard-size mark (welcome sidebar, wizard header, outro). */
	logo: readonly string[];
	gradient: GradientPalette;
}

/** Oh My Pi face — the upstream default (pink → violet → cyan → mint). */
export const PI_IDENTITY: AgentIdentity = {
	id: "oh-my-pi",
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
	tagline: "a r n o l d",
	logo: [
		"     ▄▟█▙     ",
		" ▐█▘▀██▄      ",
		"▄████▛▀██▄    ",
		"▄████████████▄",
		"▐██████████▀▀▀▘",
		"████████▌     ",
		"█████▀▜▌      ",
		"████▌ ▐▌      ",
		"▀████▙▟▘      ",
		"  ▀███▘       ",
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
};

const REGISTRY: Readonly<Record<string, AgentIdentity>> = {
	"oh-my-pi": PI_IDENTITY,
	pi: PI_IDENTITY,
	arnold: ARNOLD_IDENTITY,
};

/** Resolve an agent identity by name; unknown names fall back to Oh My Pi. */
export function getAgentIdentity(name: string = APP_NAME): AgentIdentity {
	return REGISTRY[name.toLowerCase()] ?? PI_IDENTITY;
}

/** The identity this runtime was branded with. */
export const ACTIVE_IDENTITY: AgentIdentity = getAgentIdentity();
