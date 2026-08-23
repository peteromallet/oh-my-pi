# Agent goal — `omp onboard`: native-wizard detect-first onboarding

[North Star](./northstar.md)

## Objective
Add an `omp onboard` command to oh-my-pi that reuses the setup-wizard infrastructure to deliver
a beautiful, UX-polished detect-first onboarding:
1. scan natively (AuthStorage.hasAuth/getCredentialOrigin sweep, getEnvApiKey env checks,
   models.yml parse, foreign CLI stores ~/.codex/auth.json + ~/.grok/auth.json presence);
2. render found routes first in a SelectList wizard scene (✓ ready / ● candidate / · missing,
   recommended default marked);
3. wire selection: api_key → masked Input stored via AuthStorage; oauth → reuse sign-in flow
   machinery; grok-style cli_proxy → models.yml generation (merge, atomic, $HOME-expanded);
4. verify selected route with a strict real round-trip; loop into that provider's menu on fail;
5. success screen showing route + persistence note; optional add-another loop.
Then repoint Arnold's `arnold --onboard` to exec `omp onboard` when available, keeping the
Python text flow as non-fork fallback.

## How this advances the North Star
It IS the end state: the house wizard experience applied to first-run provider setup.

## Authoritative inputs
- WizardScout report (component recipe, file:symbol map) — .oracle/findings/wizard-scout.md
- Prior Arnold-run design (UX screens, copy-vs-reference rule, persistence model, edge cases)
- User decisions this session: fork changes NOW ALLOWED (supersedes earlier constraint);
  beauty AND UX; beauty passes AFTER sense-check gates.

## In scope
- packages/coding-agent/src/commands/onboard.ts (+ registration)
- modes/setup-wizard/onboard/* : scenes + scan module (TS port of detection, native APIs)
- models.yml generation for cli_proxy routes (merge-preserving, atomic)
- arnold_agent.py --onboard: prefer exec'ing `omp onboard`, fallback to Python flow
- Targeted vitest/bun tests for scan module + scene logic (non-TTY paths)

## Non-goals
- Rewriting existing setup scenes; new visual language; new dependencies.
- Arnold-side Python UI improvements beyond the exec switch (its text flow stays as fallback).

## Settled decisions
- ox-alpha performs every role (user-pinned, standing session declaration).
- Beauty/UX pass is its own gated batch AFTER the functional batches pass sense-check/oracle.

## Authorization boundaries
- Mutate only worktree /tmp/oh-my-pi-onboard-ui branch `onboard-ui`; commit per batch.
- Sync: push `onboard-ui` to origin at completion. NEVER main/dev directly.
- Fork repo checkout ~/Documents/oh-my-pi stays clean.

## Done criteria
D1: `omp onboard` in a TTY renders the full-screen wizard with detected-routes-first list,
arrow-key navigation, masked secret entry; completes to ≥1 strictly verified route.
D2: Wiring persists in omp stores; second launch of `arnold --onboard` shows everything ready.
D3: Non-TTY `omp onboard` prints one-line guidance, exit 2; no TUI attempted.
D4: Existing `omp setup` unaffected (scenes untouched); targeted tests green.
D5: `arnold --onboard` execs `omp onboard` when present; falls back cleanly otherwise.
D6: Dedicated beauty/UX pass completed after sense-check gates, with explicit UX disposition
(keystroke count, ordering, copy) reviewed by an independent pass.

## Validation commands
- cd worktree && bun test packages/coding-agent/test/onboarding*.test.ts (or repo equivalent)
- bun --cwd=packages/coding-agent run typecheck (repo equivalent)
- Manual pty smoke: scripted keystrokes through `omp onboard` in a pty; capture transcript.
- Arnold side: uv run pytest tests/agentbox -q -k onboarding

## Stop conditions
blocked/failed/undetermined/retryable/escalate per skill contract.
