# Security Policy

OpenHand executes AI-generated actions against real systems (the filesystem,
the shell, the network, email). We take security reports seriously.

## Supported versions

We follow a "current minor + previous minor" support window during the 0.x
series. Once a 1.x release ships, the policy formalises into "current minor
plus the previous minor for six months."

| Version line | Status        | Security fixes                       |
| ------------ | ------------- | ------------------------------------ |
| 0.8.x        | Current (rc)  | Yes — actively developed             |
| 0.7.x        | Maintained    | Yes — backported from `main`         |
| 0.6.x        | Maintained    | Yes — backported from `main`         |
| 0.5.x        | End of life   | Critical only, on a best-effort basis |
| 0.4.x        | End of life   | No                                   |
| 0.3.x        | End of life   | No                                   |
| 0.2.x        | End of life   | No                                   |
| 0.1.x        | End of life   | No                                   |
| < 0.1        | Pre-release   | No                                   |

Pre-1.0 minors do not guarantee API compatibility; we will document any
breaking change in `CHANGELOG.md`. After 1.0, the previous minor line will
receive security fixes for six months from the date the next minor ships.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Use one of the following private channels:

1. **GitHub Security Advisories** (preferred):
   <https://github.com/ricardo-foundry/openhand/security/advisories/new>
2. **Email**: `security@openhand.dev` (PGP key available on request).

Please include:

- A description of the issue and its impact.
- A minimal reproduction (commit SHA, config, repro steps).
- Your assessment of severity (sandbox escape, RCE, data exfiltration, etc.).
- Whether you would like public credit once the fix ships.

## Response targets

| Phase                 | Target            |
| --------------------- | ----------------- |
| Acknowledgement       | within 72 hours   |
| Initial triage        | within 7 days     |
| Fix or mitigation     | within 30 days    |
| Public disclosure     | coordinated       |

## Scope

In scope:

- Sandbox escape from `packages/sandbox` (shell, filesystem, network).
- Prompt-injection that causes OpenHand to execute unapproved tools.
- Authentication / authorization flaws in `apps/server`.
- Secret leakage through logs, errors, or the web UI.
- Supply-chain issues in published packages.

Out of scope:

- Vulnerabilities in third-party LLM providers themselves.
- Attacks requiring a compromised machine or a malicious user with full
  shell access already (we are not an anti-malware product).
- Denial of service via deliberately expensive LLM prompts.

## Safe-harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations and service disruption.
- Give us a reasonable window to remediate before disclosure.
- Do not exfiltrate more data than necessary to demonstrate the issue.

Thank you for helping keep OpenHand and its users safe.
