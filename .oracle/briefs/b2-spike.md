# B2 spike — settled 2026-08-25

## Q1: How onboard scenes reach AuthStorage / modelRegistry / settings

- `runSetupWizard(ctx, scenes)` builds `SetupSceneHost` in `wizard-overlay.ts`
  (`#mountSceneController`): `host.ctx` IS the live `InteractiveModeContext`.
- `SignInTab` already reads `host.ctx.session.modelRegistry.authStorage`
  (sign-in.ts:93) and `host.ctx.settings` (theme.ts:107). Onboard scenes use
  exactly the same accessors — **no standalone construction, no new DI**.
- `scan.ts`'s `discoverAuthStorage()` stays as-is: read-only scan-time snapshot,
  never used for writes. All persistence goes through
  `host.ctx.session.modelRegistry.authStorage`.

## Q2: Strict single-provider verify shape

- `omp auth-gateway check --strict` drives `AuthStorage.checkCredentials({ completionProbe:
  createStrictCompletionProbe(), ... })` (auth-gateway-cli.ts:609). `checkCredentials` walks
  EVERY stored credential row — wrong shape for single-provider wizard verify (would network-probe
  unrelated providers).
- `createStrictCompletionProbe()` itself only needs `{ provider, credentialId, credential,
  signal }` and does a real `completeSimple` chat round-trip against the cheapest bundled models,
  walking "model not found" errors. **Decision: call it directly, in process** with a synthetic
  input (`credentialId: -1`) — actionable health, zero spawns, no child `omp -p`.
- Change: export `createStrictCompletionProbe` from auth-gateway-cli.ts (one-word additive edit;
  module has no import-time side effects).
- API-key persist: canonical upsert is `authStorage.set(provider, { type: "api_key", key })`
  (auth-storage.ts:2330 — handles local store + remote-broker variants + dedupe). OAuth keeps
  using `authStorage.login(...)` (the exact lifecycle SignInTab drives).
- cli_proxy (grok) has no registry presence until restart; its verify = post-write parse
  validation + running the token helper script (health of the command-backed key), NOT a chat
  round-trip. Documented limitation, matches what can honestly be verified in-process.

## Exit-code contract mechanics

- Overlay ignores `finish(result)` and advances; there is no back navigation. So:
  - Decline paths end in `postmortem.quit(1)` from inside the scene — same registered-teardown
    path `InteractiveMode.shutdown()` relies on (session teardown is a postmortem callback), but
    exits 1 instead of shutdown()'s hardcoded 0.
  - Verified route → `finish("done")` → outro → normal CLI handoff (exit 0 whenever the user
    later quits).
  - Non-TTY → B1 guard, exit 2.
- "Different-provider escape" after 3 failed attempts is an inline SelectList INSIDE scene 2
  (overlay cannot navigate backwards); Esc on that list declines → quit(1).
