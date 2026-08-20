# Local omp setup (this fork)

Machine-local runtime configuration for the omp instance that drives
subagent dispatch (see the subagent-launcher skill in the Arnold repo).

- `models.yml` — omp provider config. The `grok` provider points at the grok
  CLI proxy (`cli-chat-proxy.grok.com`) using the x.ai OIDC token from
  `~/.grok/auth.json`; NO secrets live in this file (the key is command-backed).
- `grok-token.py` — reads/refreshes the x.ai bearer token (OIDC refresh,
  ~6 h lifetime) and prints it for omp's command-backed `apiKey`. Install at
  `~/.omp/agent/grok-token.py`.
- Credentials live machine-local in omp's store (`~/.omp/agent/agent.db`:
  deepseek, openai-codex OAuth, openrouter, kimi, zai, google, minimax,
  fireworks, firecrawl, tavily) — never committed.
- omp runs from this source checkout via `~/.bun/bin/omp` ->
  `packages/coding-agent/scripts/omp` (dev launcher, `bun src/cli.ts`).
