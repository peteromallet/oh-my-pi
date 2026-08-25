# Plan v1 — `omp onboard` native wizard

Base: agent_goal.md · Scout recipe: findings/wizard-scout.md
Estimate: ~1–2 focused days. Huge run: NO.

## Architecture
```
packages/coding-agent/src/
  commands/onboard.ts            # Command subclass; lazy-imports wizard + scenes; non-TTY guard prints hint exit 2
  modes/setup-wizard/onboard/
    scan.ts                      # TS detection: registry sweep via hasAuth/getCredentialOrigin,
                                 # getEnvApiKey env checks, models.yml parse, foreign CLI store presence;
                                 # returns ranked entries {provider,status,origin,defaultModel}
    scenes.ts                    # TWO SetupScene defs (W1/K1):
                                 #   1. detect-pick: SelectList found-first, recommended marked;
                                 #      EMPTY STATE inline msg bypassing SelectList when zero hits (U1)
                                 #   2. wire+verify: per auth kind (Input mask=true api key / sign-in
                                 #      flow reuse oauth / models.yml gen cli_proxy [inlined, K3]),
                                 #      default model auto-committed (Enter-only happy path), strict
                                 #      verify with tick-glyph spinner (U2); success -> renderSetupOutro
    scan.ts                      # PURE-DATA module, no TUI imports (testable): registry sweep +
                                 # env checks + models.yml parse + foreign CLI presence
```
Registration: commands/onboard.ts added where setup.ts is registered (cli/args.ts per scout).

## Batches (beauty pass LAST, per user sequencing)
- B1: scan.ts + command registration + non-TTY guard; tests for scan ranking/status logic.
- B2: two scenes per W1 spec; UX CONSTRAINTS live here (K2): Enter-only happy path, empty
      state (U1), spinner (U2), splash fires (U3), omp copy tone (U4), footer hints (U5);
      oauth path reuses sign-in machinery; persistence assertions; pty smoke scripted keys.
- B3: Arnold switch: arnold_agent.py --onboard prefers exec `omp onboard` (PATH/branded bin),
      falls back to Python flow when missing/non-TTY; pytest updates.
- B4: BEAUTY PASS (visual only, gated after B1-B3): gradient/transition tuning, copy
      refinement pass, independent UX review with explicit keystroke-count + tone disposition.

## Areas explored
Wizard infra fully scouted (findings/wizard-scout.md). Residual unknowns → B2 implementation:
exact sign-in flow reuse seam; checkCredentials single-provider strict invocation shape.

## Open questions
1. Can scenes access AuthStorage/modelRegistry without a full session ctx? (scout says host.ctx
   carries them; verify at impl; fallback: construct standalone ModelRegistry like /providers does.)
2. Strict verify from wizard: reuse existing health-check helper vs spawn `omp -p` child?

## Risks
R1 Wizard overlay requires InteractiveMode TUI instance — headless `omp onboard` must not crash:
guard isInteractive before mounting overlay (mirrors startup-splash checks).
R2 Fork upstream hygiene: keep changes additive; no edits to existing scenes except registering.
R3 Detection duplication with Arnold Python scan: accepted — fork owns truth going forward;
Arnold fallback flow remains for old installs only.

## North Star check
House-style components only; found-first UX; one verified route; persist-once; headless guarded.
Anti-patterns explicitly barred (bare menus, clashing visuals, secret leaks, breaking omp setup).
