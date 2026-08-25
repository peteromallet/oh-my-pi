/**
 * `omp onboard` — detect-first provider onboarding.
 *
 * Differs from `omp setup`: scans for credentials the user already has
 * (omp stores, env vars, models.yml, foreign CLI stores) and lands one
 * verified model route through the standard setup-wizard overlay.
 *
 * Headless stays fail-closed: the non-TTY guard runs BEFORE any wizard/TUI
 * module enters the module graph — everything rendering-related is lazily
 * imported inside the interactive branch only.
 */

import { Command } from "@oh-my-pi/pi-utils/cli";
import { onboardHelp as commandHelp } from "../cli/command-help";

export const ONBOARD_GUARD_MESSAGE = "omp onboard needs an interactive terminal.\n";
export const ONBOARD_EXIT_CODE = 2;

export interface OnboardDependencies {
	stdinIsTTY?: boolean;
	stdoutIsTTY?: boolean;
	writeStderr?: (text: string) => void;
	exit?: (code: number) => never;
}

export async function runOnboard(deps: OnboardDependencies = {}): Promise<void> {
	const stdinIsTTY = deps.stdinIsTTY ?? process.stdin.isTTY;
	const stdoutIsTTY = deps.stdoutIsTTY ?? process.stdout.isTTY;
	if (!stdinIsTTY || !stdoutIsTTY) {
		(deps.writeStderr ?? (text => process.stderr.write(text)))(ONBOARD_GUARD_MESSAGE);
		(deps.exit ?? process.exit)(ONBOARD_EXIT_CODE);
		return;
	}
	// Guard passed — only now may TUI/wizard modules join the module graph.
	const [{ parseArgs }, { runRootCommand }, { ONBOARD_SCENES }] = await Promise.all([
		import("../cli/args"),
		import("../main"),
		import("../modes/setup-wizard/onboard/scenes"),
	]);
	await runRootCommand(parseArgs([]), [], { setupScenes: ONBOARD_SCENES });
}

export default class Onboard extends Command {
	static description = commandHelp.description;

	async run(): Promise<void> {
		await runOnboard();
	}
}
