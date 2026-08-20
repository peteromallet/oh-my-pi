# omp setup — fresh machine guide

This fork (`peteromallet/oh-my-pi`, branch `dev`) is the single omp source for
the Arnold stack: the CLI runtime (run from this checkout) and the pinned
`omp-rpc` Python client (referenced from Arnold's `pyproject.toml`).

## 1. Prerequisites

- [bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`)
- [uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- git

## 2. Clone + build omp

```bash
git clone -b dev https://github.com/peteromallet/oh-my-pi.git ~/Documents/oh-my-pi
cd ~/Documents/oh-my-pi
bun install                       # install workspace deps (or: bun run setup)
bun --cwd=packages/natives run build   # build pi_natives.<platform>-<arch>.node (required!)
ln -s ~/Documents/oh-my-pi/packages/coding-agent/scripts/omp ~/.bun/bin/omp
export PATH="$HOME/.bun/bin:$PATH"    # add to ~/.zshrc
omp --version                     # expect omp/17.4.0
```

The natives build is mandatory — `omp` fails at startup with
`Failed to load pi_natives native addon` if `packages/natives/native/` has no
`.node` file (it is a gitignored build artifact).

## 3. Provider config (no secrets committed)

```bash
mkdir -p ~/.omp/agent
cp docs/omp-setup/models.yml ~/.omp/agent/models.yml   # grok provider (CLI proxy)
cp docs/omp-setup/grok-token.py ~/.omp/agent/grok-token.py
chmod +x ~/.omp/agent/grok-token.py
```

- `models.yml` defines the `grok` provider: `cli-chat-proxy.grok.com` with the
  x.ai OIDC token from `~/.grok/auth.json`, refreshed by `grok-token.py`
  (~6 h lifetime, no API key, billed to the grok account).
- The grok CLI must be logged in once (`grok login`) to create `~/.grok/auth.json`.

## 4. Credentials (machine-local, per user)

Add provider keys to omp's own store (`~/.omp/agent/agent.db`), never commit:
deepseek, openai-codex (ChatGPT OAuth — `codex login`), openrouter, kimi, zai,
google, minimax, fireworks, firecrawl, tavily. Verify with:

```bash
omp models find deepseek    # provider appears once its key is present
omp -p --no-session --model deepseek/deepseek-v4-flash "hi"
omp -p --no-session --model grok/grok-4.6 "hi"
omp -p --no-session --model openai-codex/gpt-5.6-sol "hi"
```

## 5. Arnold (subagents + megaplan phases)

```bash
git clone https://github.com/peteromallet/Arnold.git ~/Documents/Arnold
cd ~/Documents/Arnold
uv sync --locked              # pulls omp-rpc pinned from THIS fork (peteromallet/oh-my-pi)
python -m arnold_pipelines.megaplan doctor --repo   # sanity
```

Running any megaplan CLI command auto-syncs the `subagent-launcher` skill into
`~/.claude/skills`, `~/.codex/skills`, `~/.hermes/skills`, `~/.agents/skills`
(symlinks to `arnold_pipelines/megaplan/skills/subagent-launcher/`).

## 6. Verify the subagent path

```bash
python ~/.claude/skills/subagent-launcher/launch_hermes_agent.py \
  --model="deepseek:deepseek-v4-flash" --query-file=/tmp/brief.md --project-dir="$PWD"
python ~/.claude/skills/subagent-launcher/launch_hermes_agent.py \
  --model=grok --query="Reply with exactly: ok" --project-dir="$PWD"
```

## Layout notes

- `omp` always runs from THIS checkout (`~/.bun/bin/omp` -> dev launcher ->
  `bun src/cli.ts`) — no published-binary installs.
- Arnold's `pyproject.toml` pins `omp-rpc @ git+https://github.com/peteromallet/oh-my-pi.git@<sha>#subdirectory=python/omp-rpc`.
- Credentials never leave the machine; only config shape is versioned here.
