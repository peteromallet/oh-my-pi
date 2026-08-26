/**
 * Onboard wizard scenes — detect-pick and wire+verify.
 *
 * Scene 1 ranks live scan results found-first (ready → candidate, Arnold order
 * from scan.ts), marks the preselected recommended default so Enter suffices,
 * and hides never-seen providers behind a trailing "Show all providers…" item.
 * With zero detections it renders an inline empty state instead of a list.
 *
 * Scene 2 routes by the picked entry's auth kind: existing credentials go
 * straight to a strict in-process chat probe, API-key providers get a masked
 * Input persisted through AuthStorage.set, OAuth-capable providers drive the
 * same login lifecycle as the stock sign-in panel, and grok's foreign CLI
 * store is wired through models-yml.ts (the Arnold splice semantics). Verify
 * failures loop back into the same provider (max 3 attempts) and then offer an
 * inline different-provider list; every decline exits 1 via postmortem so the
 * process only hands off to the CLI after one verified route.
 */

import type { AuthStorage, CompletionProbeCredential } from "@oh-my-pi/pi-ai";
import { PASTE_CODE_LOGIN_PROVIDERS } from "@oh-my-pi/pi-ai";
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import type { OAuthProvider } from "@oh-my-pi/pi-ai/oauth/types";
import {
	type Component,
	type Focusable,
	Input,
	matchesKey,
	routeSelectListMouse,
	type SelectItem,
	SelectList,
	type SgrMouseEvent,
	wrapTextWithAnsi,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { getAgentDir, postmortem } from "@oh-my-pi/pi-utils";
import { copyToClipboard } from "../../../utils/clipboard";
import { getSelectListTheme, theme } from "../../theme/theme";
import { SETUP_TICK_MS } from "../scenes/splash";
import type { SetupScene, SetupSceneController, SetupSceneHost } from "../scenes/types";
import { GROK_PROXY_DEFAULT_MODEL, wireCliProxyModelsYml } from "./models-yml";
import scanProvidersLive, { RECOMMENDED_MODELS, type ScanEntry } from "./scan";
import { redactSecrets, verifyCredential } from "./verify";


/**
 * Regression-pinned contract [GateFB2r]: the strict probe MUST complete before
 * any persistence write, so a dead key never lands in authStorage and poisons
 * the next scan.
 */
export async function probeThenPersist(
	key: string,
	verify: () => Promise<boolean>,
	persist: () => Promise<void>,
): Promise<boolean> {
	const ok = key.length > 0 && (await verify());
	if (!ok) return false;
	await persist();
	return true;
}

/** How the wire+verify scene services a picked entry. */
export type OnboardAuthKind = "verify" | "api_key" | "oauth" | "cli_proxy";

/** Max verify attempts for one provider before the different-provider escape. */
export const MAX_VERIFY_ATTEMPTS = 3;

/**
 * State shared between the two scene controllers of one wizard run. The
 * overlay mounts each scene fresh, so the picked entry travels through here.
 */
interface OnboardSession {
	selected: ScanEntry | null;
	entries: ScanEntry[];
}

const session: OnboardSession = { selected: null, entries: [] };

/** Fallback target for the empty-state manual path: Arnold's top route. */
function manualFallbackEntry(): ScanEntry {
	return { provider: "deepseek", status: "missing", origin: null, defaultModel: RECOMMENDED_MODELS.deepseek ?? null };
}

/** Route an entry to its wire+verify strategy. */
export function authKindForEntry(entry: ScanEntry, oauthProviderIds: ReadonlySet<string>): OnboardAuthKind {
	if (entry.status === "ready") return "verify";
	if (entry.origin?.kind === "foreign-cli") return "cli_proxy";
	if (oauthProviderIds.has(entry.provider)) return "oauth";
	return "api_key";
}

/**
 * Build the detect-pick list: ready rows prefix the house enabled dot (stock
 * list-row precedent), candidates a neutral dot, and `missing` rows are hidden
 * (a trailing "Show all providers…" item reveals them, matching the curated
 * "Browse all…" pattern). Returns the selectable rows parallel to `items`.
 */
export function buildProviderItems(
	entries: readonly ScanEntry[],
	options: { showAll: boolean },
): { items: SelectItem[]; rows: ScanEntry[]; hasHiddenMissing: boolean } {
	const hasHiddenMissing = !options.showAll && entries.some(entry => entry.status === "missing");
	const rows = entries.filter(entry => options.showAll || entry.status !== "missing");
	const preferred = preselectedEntry(rows);
	const items = rows.map(row => {
		let glyph: string;
		switch (row.status) {
			case "ready":
				// Green filled dot: unmistakably wired.
				glyph = theme.fg("success", theme.status.enabled);
				break;
			case "candidate":
				// Hollow dot: detected elsewhere but not wired yet.
				glyph = theme.fg("muted", theme.status.shadowed);
				break;
			default:
				glyph = theme.fg("dim", theme.status.shadowed);
		}
		const descriptionParts: string[] = [];
		if (row.defaultModel) descriptionParts.push(`model: ${row.defaultModel}`);
		if (row.origin) descriptionParts.push(row.origin.detail);
		if (row === preferred) descriptionParts.push("recommended");
		return {
			value: row.provider,
			label: `${glyph} ${row.provider}`,
			description: descriptionParts.length > 0 ? descriptionParts.join(" · ") : undefined,
		};
	});
	if (hasHiddenMissing) {
		items.push({ value: "show-all", label: "Show all providers…", description: "include undetected providers" });
	}
	return { items, rows, hasHiddenMissing };
}

/** Found-first preselection: first ready entry, else first candidate, else top row. */
export function preselectedEntry(rows: readonly ScanEntry[]): ScanEntry | undefined {
	return rows.find(entry => entry.status === "ready") ?? rows.find(entry => entry.status === "candidate");
}

//#region Scene 1 — detect-pick

class OnboardDetectPickController implements SetupSceneController {
	readonly title = "Choose your LLM provider";
	// Raw bold escape: chalk's support detection can yield level 0 inside the
	// compiled binary, silently dropping the emphasis.
	subtitle = `This will use \x1b[1myour existing credentials\x1b[22m from the selected provider.`;
	#list: SelectList | undefined;
	#entries: ScanEntry[] = [];
	#showAll = false;
	#scanning = true;
	#failed = false;
	/** Render line where the select list begins, or -1 while it is not shown. */
	#listRowStart = -1;

	constructor(private readonly host: SetupSceneHost) {}

	async onMount(): Promise<void> {
		try {
			this.#entries = await scanProvidersLive();
			session.entries = this.#entries;
		} catch {
			this.#failed = true;
		}
		this.#scanning = false;
		this.#rebuildList();
		this.host.requestRender();
	}

	dispose(): void {
		this.#list = undefined;
	}

	invalidate(): void {
		this.#list?.invalidate();
	}

	handleInput(data: string): void {
		if (this.#list) {
			this.#list.handleInput(data);
			return;
		}
		// Empty state / scan failure: no list to drive.
		if (matchesKey(data, "escape")) {
			this.#onEscape();
			return;
		}
		if (matchesKey(data, "enter") || matchesKey(data, "return")) {
			this.#enterManual();
		}
	}

	routeMouse(event: SgrMouseEvent, line: number, col: number): void {
		const listLine = this.#listRowStart >= 0 ? line - this.#listRowStart : Number.NEGATIVE_INFINITY;
		if (this.#list) routeSelectListMouse(this.#list, event, listLine);
	}

	render(width: number, maxLines?: number): readonly string[] {
		if (this.#scanning) {
			return [theme.fg("muted", "Scanning for credentials you already have…")];
		}
		const selectable = this.#entries.filter(entry => entry.status !== "missing");
		if (selectable.length === 0 || this.#failed) {
			return [
				theme.fg("warning", "No providers detected."),
				theme.fg("dim", "Press Enter to add an API key manually."),
			];
		}
		const list = this.#list;
		if (!list) return [];
		const lines = [theme.fg("muted", "Ready rows verify as-is — candidates reuse an existing sign-in."), ""];
		this.#listRowStart = lines.length;
		if (maxLines !== undefined) {
			list.setMaxVisible(Math.max(1, Math.min(10, maxLines - lines.length - 1)));
		}
		lines.push(...list.render(width));
		return lines;
	}

	#rebuildList(): void {
		const { items, rows } = buildProviderItems(this.#entries, { showAll: this.#showAll });
		if (rows.length === 0) {
			this.#list = undefined;
			return;
		}
		const preferred = preselectedEntry(rows);
		const primaryWidth = Math.max(...items.map(item => visibleWidth(item.label))) + 2;
		const list = new SelectList(items, Math.min(10, Math.max(1, items.length)), getSelectListTheme(), {
			maxPrimaryColumnWidth: primaryWidth,
		});
		list.setSelectedIndex(Math.max(0, rows.indexOf(preferred ?? rows[0]!)));
		list.onSelect = item => {
			if (item.value === "show-all") {
				this.#showAll = true;
				this.#rebuildList();
				this.host.requestRender();
				return;
			}
			const picked = session.entries.find(entry => entry.provider === item.value);
			if (!picked) return;
			session.selected = picked;
			this.host.finish("done");
		};
		list.onCancel = () => {
			this.#onEscape();
		};
		this.#list = list;
	}

	#enterManual(): void {
		session.selected = manualFallbackEntry();
		this.host.finish("done");
	}

	#onEscape(): void {
		void postmortem.quit(1);
	}
}

//#endregion

//#region Scene 2 — wire + verify

/** Wrapped masked input so focus ownership matches what the overlay tracks. */
class MaskedKeyInput implements Component, Focusable {
	constructor(
		private readonly input: Input,
		private readonly onCopy: () => void,
	) {}

	get focused(): boolean {
		return this.input.focused;
	}

	set focused(value: boolean) {
		this.input.focused = value;
	}

	setUseTerminalCursor(useTerminalCursor: boolean): void {
		this.input.setUseTerminalCursor(useTerminalCursor);
	}

	render(width: number): readonly string[] {
		return this.input.render(width);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "alt+c")) {
			this.onCopy();
			return;
		}
		this.input.handleInput(data);
	}

	invalidate(): void {
		this.input.invalidate();
	}
}

type WirePhase = "input" | "oauth" | "verifying" | "failed" | "pick-other" | "success";

class OnboardWireVerifyController implements SetupSceneController {
	readonly title = "Wire and verify";

	#entry: ScanEntry;
	#kind: OnboardAuthKind;
	#oauthProviderIds: ReadonlySet<string>;
	#authStorage: AuthStorage;
	#phase: WirePhase = "verifying";
	#attempts = 0;
	#error: string | undefined;
	#statusLines: string[] = [];
	#routeModel: string | undefined;
	#input: MaskedKeyInput | undefined;
	#otherList: SelectList | undefined;
	/** Render line where the pick-other list begins, or -1 while it is not shown. */
	#otherListRowStart = -1;
	#tickTimer: NodeJS.Timeout | undefined;
	#finishTimer: NodeJS.Timeout | undefined;
	#verifyStartedAt = 0;
	#disposed = false;

	// OAuth login lifecycle state (mirrors the stock SignInTab panel).
	#authUrl: string | undefined;
	#authLaunchUrl: string | undefined;
	#loginAbort: AbortController | undefined;
	#loggingIn: string | undefined;
	#prompt: { message: string; placeholder?: string; input: MaskedKeyInput } | undefined;
	#promptResolve: ((value: string) => void) | undefined;
	/** Secrets seen this scene, scrubbed from any rendered failure text. */
	#secrets: string[] = [];

	constructor(private readonly host: SetupSceneHost) {
		this.#entry = session.selected ?? manualFallbackEntry();
		this.#oauthProviderIds = new Set(getOAuthProviders().map(provider => provider.id));
		this.#kind = authKindForEntry(this.#entry, this.#oauthProviderIds);
		this.#authStorage = host.ctx.session.modelRegistry.authStorage;
		this.#routeModel =
			this.#entry.defaultModel ?? (this.#kind === "cli_proxy" ? GROK_PROXY_DEFAULT_MODEL : undefined);
	}

	get subtitle(): string {
		switch (this.#phase) {
			case "input":
				return "Your key is saved once it verifies.";
			case "oauth":
				return "Finish the browser sign-in to continue.";
			case "verifying":
				return "Sending a test request…";
			default:
				return "One verified route completes setup.";
		}
	}

	dispose(): void {
		this.#disposed = true;
		this.#stopTick();
		if (this.#finishTimer) clearTimeout(this.#finishTimer);
		this.#loginAbort?.abort();
		this.#resolvePrompt("");
		this.#input = undefined;
		this.#otherList = undefined;
	}

	invalidate(): void {
		this.#input?.invalidate();
		this.#prompt?.input.invalidate();
		this.#otherList?.invalidate();
	}

	onMount(): void {
		switch (this.#kind) {
			case "verify":
				void this.#verifyStoredCredential();
				break;
			case "api_key":
				this.#mountKeyInput();
				break;
			case "oauth":
				void this.#startLogin();
				break;
			case "cli_proxy":
				void this.#wireCliProxy();
				break;
		}
		this.host.requestRender();
	}

	handleInput(data: string): void {
		if (this.#phase === "pick-other") {
			this.#otherList?.handleInput(data);
			return;
		}
		if (this.#phase === "input" && this.#input) {
			this.#input.handleInput(data);
			return;
		}
		if (this.#phase === "oauth") {
			this.#handleOauthInput(data);
			return;
		}
		if (this.#phase === "failed") {
			if (matchesKey(data, "escape")) {
				this.#enterPickOther();
				return;
			}
			if (matchesKey(data, "enter") || matchesKey(data, "return")) {
				this.#retry();
			}
		}
	}

	routeMouse(event: SgrMouseEvent, line: number, col: number): void {
		if (this.#phase !== "pick-other" || !this.#otherList) return;
		const listLine = this.#otherListRowStart >= 0 ? line - this.#otherListRowStart : Number.NEGATIVE_INFINITY;
		routeSelectListMouse(this.#otherList, event, listLine);
	}

	render(width: number, maxLines?: number): readonly string[] {
		const lines: string[] = [];
		lines.push(theme.fg("accent", this.#routeLabel()));
		switch (this.#phase) {
			case "input":
				if (this.#error) lines.push("", ...wrapTextWithAnsi(theme.fg("error", this.#error), width));
				lines.push(
					"",
					theme.fg("dim", `Paste the ${this.#entry.provider} API key — it stays masked until saved.`),
					...(this.#input?.render(width) ?? []),
				);
				break;
			case "oauth":
				lines.push("", ...this.#renderOauth(width));
				break;
			case "verifying": {
				const elapsedSec = Math.floor((Date.now() - this.#verifyStartedAt) / 1000);
				const frames = theme.spinnerFrames;
				const frame = frames[Math.floor((Date.now() - this.#verifyStartedAt) / SETUP_TICK_MS) % frames.length];
				lines.push("", theme.fg("muted", `${frame} Verifying ${this.#routeLabel()}… ${elapsedSec}s`));
				break;
			}
			case "failed":
				lines.push("", ...wrapTextWithAnsi(theme.fg("error", this.#error ?? "Verification failed."), width));
				if (this.#kind === "api_key") {
					lines.push(
						theme.fg("dim", "Check the key and try again — Enter retries, Esc picks another provider."),
						...(this.#input?.render(width) ?? []),
					);
				} else {
					lines.push(theme.fg("dim", "Enter retries this provider · Esc picks another provider."));
				}
				break;
			case "pick-other":
				lines.push(
					"",
					theme.fg("warning", `${this.#entry.provider} did not verify after ${this.#attempts} attempts.`),
					theme.fg("dim", "Pick a different provider:"),
				);
				this.#otherListRowStart = lines.length;
				if (this.#otherList) lines.push(...this.#otherList.render(width));
				break;
			case "success":
				lines.push("", theme.fg("success", `${theme.status.success} Verified ${this.#routeLabel()}`));
				break;
		}
		if (this.#statusLines.length > 0) {
			lines.push(...this.#statusLines.flatMap(lineText => wrapTextWithAnsi(lineText, width)));
		}
		return maxLines !== undefined ? lines.slice(0, maxLines) : lines;
	}

	#routeLabel(): string {
		return this.#routeModel ? `${this.#entry.provider}/${this.#routeModel}` : this.#entry.provider;
	}

	#stopTick(): void {
		if (!this.#tickTimer) return;
		clearInterval(this.#tickTimer);
		this.#tickTimer = undefined;
	}

	#startTick(): void {
		this.#stopTick();
		this.#verifyStartedAt = Date.now();
		this.#tickTimer = setInterval(() => {
			if (!this.#disposed) this.host.requestRender();
		}, SETUP_TICK_MS);
	}

	#mountKeyInput(): void {
		const input = new Input();
		input.mask = true;
		input.prompt = "API key ";
		input.onSubmit = value => {
			const key = value.trim();
			if (!key) return;
			this.#secrets.push(key);
			void this.#persistAndVerify(key);
		};
		input.onEscape = () => {
			this.#enterPickOther();
		};
		this.#input = new MaskedKeyInput(input, () => {});
		this.#phase = "input";
		this.host.setFocus(this.#input);
	}

	async #persistAndVerify(key: string): Promise<void> {
		// Probe first with the raw key; only persist once the strict round-trip
		// succeeds, so a dead key never lands in authStorage and poisons the
		// next scan.
		await probeThenPersist(
			key,
			() =>
				new Promise<boolean>((resolve) => {
					void this.#runVerify(
						{ type: "api_key", apiKey: key },
						async () => {
							resolve(true);
						},
						{ deferSuccess: true },
					);
				}),
			async (): Promise<void> => {
				try {
					await this.#authStorage.set(this.#entry.provider, { type: "api_key", key });
				} catch (error) {
					this.#fail(redactSecrets(error instanceof Error ? error.message : String(error), this.#secrets));
					return;
				}
				await this.host.ctx.session.modelRegistry.refreshProvider(this.#entry.provider, "online");
				// Success renders only after the credential is durably stored.
				this.#succeed();
			},
		);
	}

	async #verifyStoredCredential(): Promise<void> {
		const apiKey = await this.#authStorage.peekApiKey(this.#entry.provider);
		if (!apiKey) {
			this.#fail("No usable credential found for this provider.");
			return;
		}
		await this.#runVerify({ type: "api_key", apiKey });
	}

	/** Strict chat round-trip against the chosen provider; never claims success without it. */
	async #runVerify(
		credential: CompletionProbeCredential,
		onSuccess?: () => Promise<void>,
		opts?: { deferSuccess?: boolean },
	): Promise<void> {
		this.#error = undefined;
		this.#statusLines = [];
		this.#phase = "verifying";
		this.#startTick();
		this.host.restoreFocus();
		this.host.requestRender();
		const outcome = await verifyCredential(this.#entry.provider, credential);
		if (this.#disposed) return;
		this.#stopTick();
		if (outcome.ok) {
			try {
				await onSuccess?.();
			} catch {
				// Route already proven by the probe; registry warm-up is best-effort.
			}
			if (this.#phase !== "verifying") return; // onSuccess already reported its own failure
			this.#routeModel = outcome.modelId ?? this.#routeModel;
			if (!opts?.deferSuccess) this.#succeed();
			return;
		}
		this.#fail(redactSecrets(outcome.reason ?? "verification request failed", this.#secrets));
	}

	async #wireCliProxy(): Promise<void> {
		this.#phase = "verifying";
		this.#startTick();
		this.host.requestRender();
		const wired = wireCliProxyModelsYml(this.#entry.provider, getAgentDir());
		if (!wired.ok) {
			this.#stopTick();
			this.#fail(wired.error ?? "models.yml merge failed.");
			return;
		}
		// The command-backed apiKey cannot round-trip until restart, so verify
		// the helper itself: exit status only — token bytes are never read or shown.
		const script = wired.scriptPath!;
		try {
			const proc = Bun.spawn(["python3", script], { stdout: "pipe", stderr: "pipe" });
			const stderr = await new Response(proc.stderr).text();
			const code = await proc.exited;
			this.#stopTick();
			if (code === 0) {
				this.#succeed();
				return;
			}
			this.#fail(redactSecrets(stderr.trim() || `token helper exited with code ${code}`, this.#secrets));
		} catch (error) {
			this.#stopTick();
			this.#fail(redactSecrets(error instanceof Error ? error.message : String(error), this.#secrets));
		}
	}

	#succeed(): void {
		this.#phase = "success";
		this.#error = undefined;
		this.#statusLines = [];
		this.host.restoreFocus();
		this.host.requestRender();
		this.#finishTimer = setTimeout(() => {
			if (!this.#disposed) this.host.finish("done");
		}, 900);
	}

	#fail(message: string): void {
		if (this.#finishTimer !== undefined) {
			clearTimeout(this.#finishTimer);
			this.#finishTimer = undefined;
		}
		this.#error = message;
		this.#statusLines = [];
		this.#attempts += 1;
		if (this.#attempts >= MAX_VERIFY_ATTEMPTS) {
			this.#enterPickOther();
			return;
		}
		this.#phase = "failed";
		this.host.restoreFocus();
		this.host.requestRender();
	}

	#retry(): void {
		switch (this.#kind) {
			case "verify":
				void this.#verifyStoredCredential();
				break;
			case "api_key":
				this.#phase = "input";
				this.host.setFocus(this.#input!);
				this.host.requestRender();
				break;
			case "oauth":
				void this.#startLogin();
				break;
			case "cli_proxy":
				void this.#wireCliProxy();
				break;
		}
	}

	#enterPickOther(): void {
		const remaining = session.entries.filter(entry => entry.provider !== this.#entry.provider);
		const { items } = buildProviderItems(remaining, { showAll: true });
		if (items.length === 0) {
			void postmortem.quit(1);
			return;
		}
		const primaryWidth = Math.max(...items.map(item => visibleWidth(item.label))) + 2;
		const list = new SelectList(items, Math.min(10, Math.max(1, items.length)), getSelectListTheme(), {
			maxPrimaryColumnWidth: primaryWidth,
		});
		const preferred = preselectedEntry(remaining);
		list.setSelectedIndex(Math.max(0, remaining.indexOf(preferred ?? remaining[0]!)));
		list.onSelect = item => {
			const picked = remaining.find(entry => entry.provider === item.value);
			if (!picked) return;
			this.#switchTo(picked);
		};
		list.onCancel = () => {
			void postmortem.quit(1);
		};
		this.#otherList = list;
		this.#phase = "pick-other";
		this.#error = undefined;
		this.#input = undefined;
		this.host.restoreFocus();
		this.host.requestRender();
	}

	#switchTo(entry: ScanEntry): void {
		this.#entry = entry;
		this.#kind = authKindForEntry(entry, this.#oauthProviderIds);
		this.#attempts = 0;
		this.#error = undefined;
		this.#statusLines = [];
		this.#routeModel = entry.defaultModel ?? (this.#kind === "cli_proxy" ? GROK_PROXY_DEFAULT_MODEL : undefined);
		this.#otherList = undefined;
		this.onMount();
	}

	//#region OAuth login lifecycle — mirrors the stock sign-in panel handlers

	#handleOauthInput(data: string): void {
		if (this.#loggingIn) {
			if (this.#authUrl && (matchesKey(data, "alt+c") || (data === "c" && !this.#prompt))) {
				void this.#copyAuthUrl();
				return;
			}
			if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
				this.#loginAbort?.abort();
			}
			return;
		}
		if (this.#prompt) {
			this.#prompt.input.handleInput(data);
		}
	}

	#renderOauth(width: number): string[] {
		const lines: string[] = [];
		if (this.#loggingIn) {
			lines.push(theme.bold(`Signing in to ${this.#loggingIn}`));
		} else if (this.#error) {
			lines.push(...wrapTextWithAnsi(theme.fg("error", this.#error), width));
		}
		if (this.#authUrl) {
			lines.push(
				`${theme.fg("accent", `Browser login: \x1b]8;;${this.#authUrl}\x07Open login URL\x1b]8;;\x07`)} ${theme.fg("dim", "(clipboard copy attempted; Alt+C retries)")}`,
			);
			for (const wrapped of wrapTextWithAnsi(theme.fg("dim", this.#authUrl), width).slice(0, 2)) {
				lines.push(wrapped);
			}
			if (this.#authLaunchUrl) {
				lines.push(theme.fg("dim", `Local shortcut (this machine only): ${this.#authLaunchUrl}`));
			}
		}
		if (this.#prompt) {
			lines.push(theme.fg("warning", this.#prompt.message));
			if (this.#prompt.placeholder) lines.push(theme.fg("dim", this.#prompt.placeholder));
			lines.push(this.#prompt.input.render(width)[0] ?? "");
		}
		return lines;
	}

	async #startLogin(): Promise<void> {
		if (this.#loggingIn || this.#disposed) return;
		const providerId = this.#entry.provider;
		const useManualInput = PASTE_CODE_LOGIN_PROVIDERS.has(providerId);
		this.#loggingIn = providerId;
		this.#error = undefined;
		this.#statusLines = [theme.fg("dim", "Starting OAuth flow…")];
		this.#authUrl = undefined;
		this.#authLaunchUrl = undefined;
		this.#loginAbort = new AbortController();
		this.#phase = "oauth";
		this.host.restoreFocus();
		this.host.requestRender();
		try {
			await this.#authStorage.login(providerId as OAuthProvider, {
				signal: this.#loginAbort.signal,
				onAuth: info => {
					this.#authUrl = info.url;
					this.#authLaunchUrl = info.launchUrl && info.launchUrl !== info.url ? info.launchUrl : undefined;
					this.#statusLines = [];
					if (info.instructions) {
						this.#statusLines.push(theme.fg("warning", info.instructions));
					}
					if (useManualInput) {
						this.#statusLines.push(theme.fg("dim", "Paste the returned code or redirect URL when prompted."));
					}
					void this.#copyAuthUrl();
					this.host.ctx.openInBrowser(info.url);
					this.host.requestRender();
				},
				onPrompt: prompt => this.#showPrompt(prompt),
				onManualCodeInput: () =>
					this.#showPrompt({ message: "Paste the authorization code (or full redirect URL):" }),
			});
			if (this.#disposed) return;
			// Provider-scoped online refresh so the just-persisted credential is
			// authoritative before the strict probe runs (#5780).
			await this.host.ctx.session.modelRegistry.refreshProvider(providerId, "online");
			this.#loggingIn = undefined;
			this.#loginAbort = undefined;
			const apiKey = await this.#authStorage.peekApiKey(providerId);
			if (!apiKey) {
				this.#fail("Sign-in completed but no usable credential was stored.");
				return;
			}
			await this.#runVerify({ type: "api_key", apiKey });
		} catch (error) {
			if (this.#disposed) return;
			const cancelled = this.#loginAbort?.signal.aborted;
			this.#loggingIn = undefined;
			this.#loginAbort = undefined;
			this.#authUrl = undefined;
			this.#authLaunchUrl = undefined;
			this.#fail(
				cancelled
					? "Login cancelled."
					: redactSecrets(
							`Login failed: ${error instanceof Error ? error.message : String(error)}`,
							this.#secrets,
						),
			);
		}
	}

	async #copyAuthUrl(): Promise<void> {
		const url = this.#authUrl;
		if (!url) return;
		try {
			await copyToClipboard(url);
		} catch {
			// Clipboard integration is best-effort; the full URL remains rendered below.
		}
		this.host.requestRender();
	}

	async #showPrompt(prompt: { message: string; placeholder?: string }): Promise<string> {
		this.#resolvePrompt("");
		const input = new Input();
		const wrapped = new MaskedKeyInput(input, () => {
			void this.#copyAuthUrl();
		});
		const pending = Promise.withResolvers<string>();
		this.#promptResolve = pending.resolve;
		this.#prompt = { message: prompt.message, placeholder: prompt.placeholder, input: wrapped };
		input.onSubmit = value => {
			this.#resolvePrompt(value);
		};
		input.onEscape = () => {
			this.#loginAbort?.abort();
			this.#resolvePrompt("");
		};
		this.host.setFocus(wrapped);
		this.host.requestRender();
		return pending.promise;
	}

	#resolvePrompt(value: string): void {
		const resolve = this.#promptResolve;
		if (!resolve) return;
		this.#promptResolve = undefined;
		this.#prompt = undefined;
		this.host.restoreFocus();
		resolve(value);
		this.host.requestRender();
	}

	//#endregion
}

//#endregion

export const ONBOARD_SCENES: readonly SetupScene[] = [
	{
		id: "onboard-detect",
		title: "Choose your LLM provider",
		minVersion: 0,
		mount(host: SetupSceneHost): SetupSceneController {
			return new OnboardDetectPickController(host);
		},
	},
	{
		id: "onboard-wire-verify",
		title: "Wire and verify",
		minVersion: 0,
		mount(host: SetupSceneHost): SetupSceneController {
			return new OnboardWireVerifyController(host);
		},
	},
];
