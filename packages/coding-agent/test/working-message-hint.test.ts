import { beforeAll, describe, expect, it } from "bun:test";
import { renderWorkingMessage } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

function escHint(): string {
	return ` ${theme.format.bracketLeft}esc${theme.format.bracketRight}`;
}

function backgroundHint(): string {
	return ` ${theme.format.bracketLeft}bg → ctrl+alt+b${theme.format.bracketRight}`;
}

describe("renderWorkingMessage background hint", () => {
	beforeAll(async () => {
		await initTheme(false);
	});

	it("renders the composed background hint once, styled after the interrupt hint", () => {
		// The loader's plain message carries the hint (pre-layout); the renderer
		// must strip it from the header and re-emit it as a single hint segment.
		const composed = `Working…${escHint()}${backgroundHint()}`;
		const out = Bun.stripANSI(renderWorkingMessage(composed, undefined, backgroundHint()));
		expect(out).toContain("Working…");
		expect(out).toContain("esc");
		expect(out).toContain("bg → ctrl+alt+b");
		expect(out.indexOf("bg")).toBeGreaterThan(out.indexOf("esc"));
		expect(out.split("bg → ctrl+alt+b")).toHaveLength(2); // exactly once
	});

	it("renders a plain message unchanged when no background hint is involved", () => {
		const out = Bun.stripANSI(renderWorkingMessage(`Working…${escHint()}`, undefined));
		expect(out).toContain("esc");
		expect(out).not.toContain("bg");
	});

	it("ignores the background hint for messages that do not end with the interrupt hint", () => {
		const out = Bun.stripANSI(renderWorkingMessage("Compacting context…", undefined, backgroundHint()));
		expect(out).not.toContain("bg");
	});
});
