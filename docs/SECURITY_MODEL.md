# OpenHand Security Model

OpenHand runs AI-generated actions against real resources: your filesystem,
your shell, your network, your mailbox. The security model is the thing that
makes that tolerable. This doc explains **what is isolated, what is allowed
by default, and how policy is expressed**.

Also read [`SECURITY.md`](../SECURITY.md) for responsible disclosure.

---

## 1. Defense in depth

```
       ┌──────────────────────┐
       │    Agent plan        │  LLM decides: "call tool X with args Y"
       └──────────┬───────────┘
                  ▼
       ┌──────────────────────┐
       │    Policy engine     │  Allow / ask-user / deny, per tool + args
       └──────────┬───────────┘
                  ▼
       ┌──────────────────────┐
       │    Sandbox           │  Confine fs roots, timeouts, output size,
       │                      │  env scrub, signal handling
       └──────────┬───────────┘
                  ▼
       ┌──────────────────────┐
       │    Tool handler      │  Typed args, validated against schema
       └──────────────────────┘
```

Every layer exists to compensate for mistakes in the others. An LLM plan
alone is never sufficient to cause side effects.

---

## 2. Default policy

Built-in tools and their default posture:

| Tool              | Sandboxed | Default policy               | Notes                                      |
| ----------------- | --------- | ---------------------------- | ------------------------------------------ |
| `file_read`       | yes       | allow (inside FS roots)      | Outside roots → deny.                      |
| `file_list`       | yes       | allow (inside FS roots)      |                                            |
| `file_search`     | yes       | allow (inside FS roots)      |                                            |
| `file_write`      | yes       | **require approval**         | Even inside roots, for first write.        |
| `shell_exec`      | yes       | **require approval**         | Strict arg parser rejects redirects, pipes, backticks, command substitution, NUL bytes, unterminated quotes, and chained `;` / `&&` / `||`. |
| `browser_fetch`   | no        | allow                        | HTTPS-preferred; plain HTTP logged.        |
| `browser_extract` | no        | allow                        |                                            |
| `browser_search`  | no        | allow                        | Respect `SEARCH_PROVIDER` env.             |
| `email_read`      | no        | allow                        | Read-only IMAP.                            |
| `email_send`      | no        | **require approval**         | Every send asks the user.                  |
| `system_info`     | no        | allow                        | No secrets included (env vars scrubbed).   |
| `system_note`     | yes       | allow                        | Writes only under `$OPENHAND_HOME/notes`.  |

Default is intentionally pessimistic for anything that has a side effect
("write", "send", "exec"). You can override in config.

---

## 3. Sandbox guarantees

`packages/sandbox` enforces the following on every tool invocation:

1. **Filesystem roots** — tools can only touch paths under a configured
   allowlist (`SANDBOX_FS_ROOTS`, default `$OPENHAND_HOME/workspace`). Path
   traversal (`..`, symlinks outside the root) is rejected.
2. **Timeouts** — every call has a hard wallclock limit
   (`SANDBOX_TOOL_TIMEOUT_MS`, default 15s). Runaway processes are killed.
3. **Output caps** — return values and stdout are truncated at
   `SANDBOX_TOOL_MAX_OUTPUT_BYTES` (default 1 MiB).
4. **Shell hardening** — the shell tool uses a strict tokenizer (see
   `packages/sandbox` tests) that rejects:
   - command substitution (`$()`, backticks)
   - redirects (`>`, `<`, `>>`)
   - chains and groups (`;`, `&&`, `||`, `|`)
   - NUL bytes, unterminated quotes, empty input
5. **Environment scrubbing** — tools receive a filtered env. `OPENAI_*`,
   `ANTHROPIC_*`, and anything matching `*_KEY`, `*_SECRET`, `*_TOKEN`,
   `*_PASS*` is withheld unless a tool explicitly requests it via its
   declared permissions.
6. **Approval tokens** — when policy says "ask", the sandbox will not run
   the tool until it receives a one-shot approval token from the user
   interface. Tokens are bound to a specific `(tool, args-hash, session)`
   tuple.

---

## 4. Policy language

Policy is a list of rules evaluated in order. The first matching rule wins.

```jsonc
{
  "rules": [
    { "tool": "file_write", "path": "~/projects/**", "action": "allow" },
    { "tool": "file_write", "action": "ask" },
    { "tool": "shell_exec", "command": "^ls( |$)", "action": "allow" },
    { "tool": "shell_exec", "action": "ask" },
    { "tool": "email_send", "action": "ask" },
    { "tool": "*", "action": "allow" }
  ]
}
```

Actions: `allow`, `ask`, `deny`.

Match keys per tool:

- `file_*`: `path` (glob, `~` expands to `OPENHAND_HOME`).
- `shell_exec`: `command` (regex against the canonicalised argv[0..]).
- `browser_fetch`: `url` (regex).
- `email_send`: `to` (regex) and `subject` (regex).

Rules are evaluated **before** the sandbox. The sandbox is your last line of
defence if policy has a bug.

---

## 5. Threats considered

| Threat                                                      | Mitigation                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| LLM is prompted to `rm -rf ~`                               | `shell_exec` asks by default; sandbox rejects `;`, `&&`, etc.  |
| LLM reads `~/.ssh/id_rsa` via `file_read`                   | FS root allowlist does not include `~/.ssh`.                   |
| LLM writes a web shell under `apps/web/public/`             | First `file_write` requires approval; arg pattern visible.     |
| LLM exfiltrates secrets by `browser_fetch`-ing attacker URL | Env vars matching secret patterns are not exposed to tools.    |
| Plugin declares `network:http` but tries to `fs:write`      | Sandbox denies the call; plugin loader logs a policy violation.|
| Tool returns 1 GiB of data                                  | Output capped at `SANDBOX_TOOL_MAX_OUTPUT_BYTES`.              |
| Runaway shell command                                       | Killed at `SANDBOX_TOOL_TIMEOUT_MS`.                           |

---

## 6. What OpenHand does *not* protect against

- A maliciously crafted plugin installed locally by the user. Treat plugins
  like any other dependency — review before you `npm install`.
- A compromised LLM provider that returns malicious JSON plans that happen
  to match all your policy rules. Keep your policy pessimistic.
- A user who turns everything to `allow` and walks away. The approval layer
  is there for a reason.

If you find a gap, please follow [`SECURITY.md`](../SECURITY.md).
