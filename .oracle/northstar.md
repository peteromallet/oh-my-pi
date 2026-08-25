# North Star — omp-native provider onboarding

## End state
Launching `arnold --onboard` (or `omp onboard`) opens the SAME beautiful full-screen wizard
experience omp already has — animated intro, arrow-key lists, masked inputs, branded frames —
wired to a detect-first flow that lands one verified model route in under a minute.

## Principles
- **Reuse the house style.** Build exclusively on existing pi-tui components (SelectList,
  Input(mask), Container, TabBar) inside the existing SetupWizard overlay. If a custom widget
  is needed, it must be indistinguishable from a stock one.
- **UX before decoration.** Found-first ordering; recommended default preselected so Enter
  suffices; every screen states what happens next; Esc always means "no"; provenance shown
  compactly (dim, never noisy); progress feels like forward motion, never a form.
- **One verified route is done.** Verify with a real round-trip before claiming success;
  failure loops into that provider's menu, never back to square one.
- **Persist once, silently forever** — all wiring lands in omp's own stores.
- **Headless stays fail-closed.** Non-TTY invocations print guidance, never half-rendered TUI.

## Anti-patterns
- Bare numbered text menus pretending to be a wizard (the thing we are replacing).
- A parallel visual language: new colors/glyphs/layout conventions that clash with omp's.
- Detection results dumped as a wall; secrets anywhere on screen after entry.
- Fork changes that break `omp setup`, the standard scenes, or upstream merge hygiene
  (additive files/commands only where possible).
