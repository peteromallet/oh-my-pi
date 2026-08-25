/**
 * Onboard wizard scene list.
 *
 * B1 PLACEHOLDER: renders the live {@link scanProvidersLive} results so the
 * command wires end-to-end through the standard SetupWizard overlay. The final
 * detect-pick / wire-and-verify scenes (W1/K1) replace this module in B2.
 */

import { matchesKey } from "@oh-my-pi/pi-tui";
import type { SetupScene, SetupSceneController, SetupSceneHost } from "../scenes/types";
import type { ScanEntry } from "./scan";
import scanProvidersLive from "./scan";

const STATUS_GLYPHS: Record<string, string> = {
	ready: "✓",
	candidate: "+",
	missing: "·",
};

function formatEntry(entry: ScanEntry): string {
	const glyph = STATUS_GLYPHS[entry.status] ?? " ";
	const origin = entry.origin ? ` (${entry.origin.detail})` : "";
	return ` ${glyph} ${entry.provider}${origin}`;
}

class OnboardDetectPlaceholder implements SetupSceneController {
	readonly title = "Provider detection";
	subtitle = "Scanning for credentials you already have…";
	#lines: readonly string[] = [];

	constructor(private readonly host: SetupSceneHost) {}

	onMount(): void {
		void scanProvidersLive()
			.then(entries => {
				this.#lines = entries.map(formatEntry);
				this.subtitle = "Enter to continue · Esc to skip";
				this.host.requestRender();
			})
			.catch(() => {
				this.#lines = [" Detection failed."];
				this.subtitle = "Enter to continue · Esc to skip";
				this.host.requestRender();
			});
	}

	render(width: number): readonly string[] {
		if (this.#lines.length === 0) return [" Scanning…"];
		return this.#lines.map(line => line.slice(0, Math.max(1, width)));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.host.finish("skipped");
			return;
		}
		if (matchesKey(data, "enter") || matchesKey(data, "return") || matchesKey(data, "space")) {
			this.host.finish("done");
		}
	}
}

export const ONBOARD_SCENES: readonly SetupScene[] = [
	{
		id: "onboard-detect",
		title: "Detect providers",
		minVersion: 0,
		mount(host: SetupSceneHost): SetupSceneController {
			return new OnboardDetectPlaceholder(host);
		},
	},
];
