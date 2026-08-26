import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Args, Command } from "@oh-my-pi/pi-utils/cli";
import { getAgentDir } from "@oh-my-pi/pi-utils";

/**
 * Scaffold a per-instance agent identity. Strong defaults: the gradient
 * palette is derived deterministically from the name (hash -> hue), so
 * `omp identity scout` yields a distinct, coherent face with zero input;
 * everything in the JSON is then editable by hand.
 */
export class IdentityCommand extends Command {
	static description = "scaffold a per-agent visual identity (logo art, colors)";
	static args = {
		name: Args.string({ description: "Agent name (letters, digits, dashes)", required: true }),
	};

	async run(): Promise<void> {
		const { args } = await this.parse(IdentityCommand);
		const name = args.name;
		if (!name || !/^[a-z][a-z0-9-]*$/i.test(name)) {
			console.error("usage: omp identity <name>   (letters, digits, dashes)");
			return;
		}
		const dir = join(getAgentDir(), "identities");
		const path = join(dir, `${name}.json`);
		if (!existsSync(path)) {
			const key = name.toLowerCase();
			// FNV-1a -> stable hue per name.
			let hash = 0x811c9dc5;
			for (let i = 0; i < key.length; i++) {
				hash ^= key.charCodeAt(i);
				hash = Math.imul(hash, 0x01000193) >>> 0;
			}
			const hue = hash % 360;
			const stops = [0, 0.25, 0.5, 0.75, 1].map(t =>
				hslToHex((hue + t * 24 - 12 + 360) % 360, 0.85, 0.38 + t * 0.34),
			);
			const ramp = stops.map(hex => nearest256(hex));
			const identity = {
				displayName: name[0].toUpperCase() + name.slice(1),
				tagline: key.replace(/(.)/g, "$1 ").trim(),
				logo: ["    ▄▄▄    ", "  ▄█████▄  ", " █████████ ", "  ▀█████▀  ", "    ▀▀▀    "],
				gradient: { stops, ramp256: ramp },
			};
			writeFileSync(path, `${JSON.stringify(identity, null, "\t")}\n`, { mode: 0o644 });
			console.log(`Wrote ${path}`);
			console.log("Edit the logo lines and gradient stops to taste; they hot-reload on next launch.");
		} else {
			console.log(`${path} already exists — leaving it untouched.`);
		}
		await this.preview(path);
	}

	async preview(path: string): Promise<void> {
		try {
			const raw = JSON.parse(readFileSync(path, "utf8")) as {
				logo?: string[];
				gradient?: { stops?: string[][]; ramp256?: number[] };
			};
			if (!Array.isArray(raw.logo)) return;
			const stops = (raw.gradient?.stops ?? []).map(stop => stop.map(Number) as [number, number, number]);
			const ramp = raw.gradient?.ramp256 ?? [];
			const width = Math.max(...raw.logo.map(l => l.length));
			const rows = raw.logo.length;
			console.log("");
			for (let y = 0; y < rows; y++) {
				let lineOut = "";
				for (let x = 0; x < raw.logo[y]!.length; x++) {
					const char = raw.logo[y]![x];
					if (char === " ") {
						lineOut += " ";
						continue;
					}
					const t = (x + (rows - 1 - y)) / Math.max(1, width + rows - 1);
					let esc: string;
					if (stops.length >= 2) {
						const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
						const f = t * (stops.length - 1) - seg;
						const mix = (i: 0 | 1 | 2) =>
							Math.round(stops[seg]![i]! + (stops[seg + 1]![i]! - stops[seg]![i]!) * f);
						esc = `\x1b[38;2;${mix(0)};${mix(1)};${mix(2)}m`;
					} else if (ramp.length > 0) {
						const idx = Math.min(ramp.length - 1, Math.max(0, Math.floor(t * (ramp.length - 1) + 0.5)));
						esc = `\x1b[38;5;${ramp[idx]}m`;
					} else {
						esc = "";
					}
					lineOut += esc + char + "\x1b[39m";
				}
				console.log(lineOut.padStart(lineOut.length + Math.floor((60 - width) / 2)));
			}
			console.log("");
		} catch {
			// Preview is best-effort; scaffold errors surface above.
		}
	}
}

function hslToHex(h: number, s: number, l: number): string {
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
	};
	return `#${f(0).toString(16).padStart(2, "0")}${f(8).toString(16).padStart(2, "0")}${f(4).toString(16).padStart(2, "0")}`;
}

function nearest256(hex: string): number {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	let best = 16;
	let bestDist = Infinity;
	for (let i = 16; i < 256; i++) {
		const qr = 55 + Math.floor(i / 36) * 40;
		const qg = 55 + (Math.floor(i / 36) % 6) * 40;
		const qb = 55 + (i % 6) * 40;
		const dist = (qr - r) ** 2 + (qg - g) ** 2 + (qb - b) ** 2;
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
}

export default IdentityCommand;
