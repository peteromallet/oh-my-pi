/**
 * Strict in-process credential verification for the onboard wizard.
 *
 * Drives `createStrictCompletionProbe` (the same probe `omp auth-gateway check
 * --strict` uses) directly with a synthetic single-credential input, so verify
 * is a real chat round-trip against the chosen provider without spawning a
 * child `omp -p` or network-probing unrelated stored credentials.
 */

import type { CompletionProbeCredential, CompletionProbeInput, Provider } from "@oh-my-pi/pi-ai";
import { createStrictCompletionProbe } from "../../../cli/auth-gateway-cli";

export interface VerifyOutcome {
	ok: boolean;
	/** Model id that answered the probe when `ok`. */
	modelId?: string;
	/** Failure / unverifiable reason; redacted of key-shaped material. */
	reason?: string;
}

/** Belt-and-braces scrub mirroring Arnold's detect/wire redaction: covers
 *  sk-* (incl. sk-ant-api03-, sk-proj-, sk-or-v1-) and xai-* key shapes. */
const SECRET_RE = /(?:sk|xai)-[A-Za-z0-9_-]{8,}/g;

export function redactSecrets(text: string, extraSecrets: readonly string[] = []): string {
	let redacted = text.replace(SECRET_RE, "[REDACTED]");
	for (const secret of extraSecrets) {
		if (secret.length >= 8) redacted = redacted.split(secret).join("[REDACTED]");
	}
	return redacted;
}

const VERIFY_TIMEOUT_MS = 60_000;

export async function verifyCredential(
	provider: string,
	credential: CompletionProbeCredential,
): Promise<VerifyOutcome> {
	const input: CompletionProbeInput = {
		provider: provider as Provider,
		credentialId: -1,
		credential,
		signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
	};
	try {
		const result = await createStrictCompletionProbe()(input);
		return { ok: result.ok === true, modelId: result.modelId, reason: result.reason };
	} catch (error) {
		return { ok: false, reason: redactSecrets(error instanceof Error ? error.message : String(error)) };
	}
}
