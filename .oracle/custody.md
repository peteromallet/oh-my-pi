# Custody — onboard-ui run (oh-my-pi)
- 2026-08-25; repo ~/Documents/oh-my-pi (origin peteromallet/oh-my-pi, upstream can1357)
- Source ref: main @ 9713c0162cb3112b2957fdc2127e8011f9a2e033 ("brand: arnold identity across CLI surface")
- Worktree: /tmp/oh-my-pi-onboard-ui branch onboard-ui
- Fork checkout ~/Documents/oh-my-pi CLEAN at baseline; must remain clean.
- omp binary ~/.bun/bin/omp runs from the fork checkout (dev launcher -> bun src/cli.ts) —
  NOTE: installed runtime uses THE CHECKOUT, so worktree testing needs bun --cwd=<worktree>
  or OMP_BIN override; never mutate the checkout to test.
- Live credentials on machine usable for strict verify.
