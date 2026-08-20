# Building agents on top of omp

omp ships a first-class agent-definition format. An *agent* is a markdown file:
YAML frontmatter that names the agent and its capabilities, then the system
prompt that becomes the agent's personality and operating rules. Drop a file in
an agents directory and the agent is discoverable by name — by the `task` /
`agent` subagent machinery and by the `agent` CLI launcher described below.

This is the same mechanism the bundled `scout`, `reviewer`, `designer`,
`librarian`, `security-reviewer`, `task`, `sonic`, and `resident` agents use.

## Where agents live

| Scope | Directory | Notes |
| --- | --- | --- |
| Bundled | `packages/coding-agent/src/prompts/agents/*.md` | Shipped with omp; embedded at build time |
| User | `~/.omp/agent/agents/*.md` | `omp agents unpack` materializes bundled agents here |
| Project | `.omp/agents/*.md` | Per-repo agents; committed with the repo |

Resolution precedence for a name: **project → user → bundled**. Project agents
shadow user agents shadow bundled agents. See `src/task/discovery.ts` for the
canonical search (also honors `.agent`/`.agents` skill-style dirs).

Materialize bundled agents into your user directory:

```sh
omp agents unpack            # -> ~/.omp/agent/agents/
omp agents unpack --project  # -> ./.omp/agents/
omp agents unpack --force    # overwrite local copies with bundled versions
```

## Agent file format

```md
---
name: triager
description: Triage GitHub issues: classify, propose labels, draft next actions.
tools: read, grep, glob, bash, web_search
model: "@task"
thinking-level: medium
---

You are the triager. For every issue you are handed:

1. Classify it (bug / feature / question / chore) with one-line evidence.
2. Propose 2-3 labels from the repo's convention.
3. Draft the next action for a human or a fixer agent.

Keep output under 15 lines. Never edit files unless asked.
```

### Frontmatter fields

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | **required.** Agent id used by `task`/`agent` and the `agent` CLI. |
| `description` | string | **required.** One-liner for agent selection. Start with "Use when…" or "MUST be used for…" so a dispatcher can pick it correctly. |
| `tools` | list | Restrict the agent to these tools (e.g. `read, grep, glob, web_search`). Omit for the default toolset. |
| `spawns` | list or `*` | Which agents this agent may spawn (`*` = any). |
| `model` | string/list | Model role/pattern (e.g. `"@smol"`, `"@task"`, `"@plan"`) or an explicit model. |
| `thinking-level` | string | `none` / `low` / `medium` / `high` thinking effort. |
| `output` | JSON schema | Structured `yield` result schema for the agent's final answer. |
| `blocking` | bool | Mark subagent runs as blocking. |
| `autoloadSkills` | list | Skills to autoload into the agent's session. |
| `read-summarize` | bool | `false` = the agent's `read` returns verbatim file content instead of structural summaries. |
| `prewalk` | bool/string | Prewalk hand-off on first edit/write (`true` = default target, string = custom model pattern). |

The body after the frontmatter is the system prompt. It replaces the default
instruction template for that agent's session (the generated project context,
skills, and rules still load; see `docs/system-prompt-customization.md` for the
underlying mechanism).

## Using an agent

**As a subagent** — inside any omp session, the `task` tool (and the `agent`
selector in SDK-style invocation) resolves agents by name:

```
task: triager -> classify the failing spec test
```

**From the CLI** — the `agent` launcher (installed next to `omp`):

```sh
agent list                      # every discoverable agent, both scopes
agent run triager "classify tests/test_foo.py"   # one-shot (print mode)
agent run triager               # interactive TUI session with that persona
agent run resident              # the bundled resident/operator persona
agent new triager "Issue triage agent"           # scaffold into ~/.omp/agent/agents/
```

`agent run <name>` resolves project → user → bundled (unpacking bundled agents
on first use), strips the frontmatter, and launches omp with the prompt body as
`--system-prompt`. With a message argument it runs one-shot print mode; without
one it opens an interactive session, so `agent run resident` is a long-lived
operator you can talk to and resume. Pass additional omp flags after the name
(e.g. `agent run resident --resume`).

## The resident agent

`resident` is the bundled agent built from the Arnold AgentBox resident's
operator prompt (`agentbox-operator-v1`, sourced from the Arnold repo's
`agentbox/resident_profile.py`). It runs the exact prompt the Discord resident
uses — concise operator replies, inspect ambiguous state before asking, at most
one clarifying question — as a CLI agent:

```sh
agent run resident "what is the status of the m11 chain?"
```

The Discord-specific clauses (`read_reply_chain`, reply-ancestor preloads) are
kept verbatim; they are inert without Discord tooling. Fork `resident.md` into
your user or project agents dir and drop those clauses to get a pure CLI
operator persona.

## Building and shipping your own

1. `agent new <name> "<description>"` (or copy `resident.md`).
2. Edit the prompt body; tune frontmatter (`tools`, `model`, `thinking-level`,
   `output`).
3. Run it: `agent run <name> "…"` — iterate on the prompt until the behavior
   sticks.
4. Ship it: bundled agents live in `src/prompts/agents/` (registered in
   `src/task/agents.ts` `EMBEDDED_AGENT_DEFS`); project agents live in
   `.omp/agents/` and travel with the repo.

For agents that need more than a prompt — custom tools, lifecycle hooks, slash
commands — see `docs/custom-tools.md`, `docs/hooks.md`, and
`docs/extensions.md`; `tools` frontmatter can restrict an agent to exactly the
surface it should have.
