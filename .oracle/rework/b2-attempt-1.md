# Rework tasklist — b2 attempt 1 (from GateFB2)
1. [normal] scenes.ts #persistAndVerify: authStorage.set() runs BEFORE strict probe -> dead key
   persists on failure and poisons next scan. Fix: probe first (takes key directly), set() only
   on verify success before refreshProvider. Update tests covering the ordering.
2. [normal] ready-row prefix: theme.status.success ✔ -> status.enabled dot per stock list rows
   (oauth-selector/model-hub/model-browser precedent). ✔ reserved for terminal confirmation lines.
3. [normal] MaskedKeyInput: drop bare-"c" interception (keep alt+c); stock CopyablePromptInput
   precedent; typing "c..." must not lose first char.
4. [normal] wrap provider error text with wrapTextWithAnsi before pushing in input/failed phases
   and oauth error line (multi-line errors break margin + body budget).
Acceptance: all fixed; suites green; pty smoke re-run shows wrapped error rendering.
