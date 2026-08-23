# Tasklist v1 (PROPOSED) — plan v2 digest 5b06d11f
Model policy: USER-PINNED ox-alpha every class. No [XHARD] proposed.
Sync: push `onboard-ui` branch only; fork checkout stays clean.
Contract-review dispositions folded in:
- Q1/Q2 (AuthStorage access without session ctx; strict verify shape) resolve FIRST inside B2
  via a 30-min spike before scene code; record findings in briefs/b2-spike.md.
- B2 must differentiate `omp onboard` help text from `omp setup` ("detect-first onboarding"
  vs "general setup") to prevent user confusion.
- B4 UX review rubric fixed NOW: happy-path keystroke count (target <=2: Enter at pick,
  Enter at model), ordering sanity vs northstar found-first, tone match vs stock wizard
  screens; reviewer = fresh independent subagent; verdict PASS or issues.
- B3 uses Arnold-side _select_omp_bin logic from agentbox/arnold_agent.py (repo ~/Documents/Arnold).

## Batch 1 — Scan + command shell
1. `modes/setup-wizard/onboard/scan.ts`: PURE-DATA (no TUI imports). Ranked detection:
   registry sweep via AuthStorage.hasAuth/getCredentialOrigin + getEnvApiKey/getEnvApiKeyName,
   models.yml parse, foreign CLI presence (~/.codex/auth.json, ~/.grok/auth.json → candidate
   origins), Arnold-route-first rank order. Export types + `scanProviders(deps)` with injected
   deps for tests. Foreign-CLI checks private helpers.
2. `commands/onboard.ts`: Command subclass, registered beside setup.ts. Non-TTY guard: print
   one-line guidance, exit 2 BEFORE any TUI import (lazy imports). isInteractive mirrors
   startup-splash checks (R1).
Acceptance B1: bun tests for scan ranking/status/origin logic incl. foreign-store candidates;
non-TTY unit test proves no TUI module loaded; typecheck clean.

## Batch 2 — Scenes (UX structure lives HERE per W1/K2)
1. Scene 1 detect-pick: SelectList found-first w/ ✓/●/· markers + dim provenance + recommended
   suffix; EMPTY STATE inline message bypassing SelectList when zero hits [U1]; Esc = decline.
2. Scene 2 wire+verify: api_key → Input(mask=true); oauth → reuse sign-in flow machinery;
   cli_proxy → inlined models.yml generation (merge-preserving, atomic, $HOME-expanded);
   default model auto-committed (Enter-only happy path); strict verify w/ tick-glyph spinner
   on SETUP_TICK_MS frames [U2]; fail → loop into same provider's menu (max 3); success →
   renderSetupOutro reuse.
3. Splash fires via scenes list wiring to wizard-overlay [U3]; omp copy tone: imperative title
   + next-step subtitle [U4]; scene-specific footer hints [U5].
4. Tests: scan→scene data mapping; wire paths vs sandboxed stores; pty smoke scripted keystrokes.
Acceptance B2: Enter-only happy path demonstrable in pty transcript; all targeted tests green.

## Batch 3 — Arnold switch
`agentbox/arnold_agent.py` --onboard: resolve branded omp bin (existing _select_omp_bin logic),
exec `omp onboard` inheriting stdio; FileNotFoundError/OSError or exit-2 → fall back to Python
flow; keep flag arg rules. Update pytest trigger tests.
Acceptance B3: pytest green; fallback path tested.

## Batch 4 — BEAUTY PASS (visual only, after gates per user sequencing)
Gradient/transition tuning reusing splash/welcome primitives; copy refinement sweep (tone
consistency across scenes); independent UX review pass with explicit disposition: keystroke
count on happy path, ordering sanity, tone match vs stock wizard screens.
Acceptance B4: UX review PASS; visual params changed only (no input-handling rewrites).

## Synchronization
Strict chain B1→B2→B3→B4. No intra-batch parallelism needed except B1 tasks 1–2.

--- FROZEN 2026-08-25 after PASS contract review (ContractReview2). ---
