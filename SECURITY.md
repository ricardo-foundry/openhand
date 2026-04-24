# Security Policy

OpenHand executes AI-generated actions against real systems (the filesystem,
the shell, the network, email). We take security reports seriously.

## Supported versions

| Version | Supported     |
| ------- | ------------- |
| 0.1.x   | Yes (current) |
| < 0.1   | No            |

Once we cut a 1.x release, the previous minor line will receive security
fixes for six months.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Use one of the following private channels:

1. **GitHub Security Advisories** (preferred):
   <https://github.com/Ricardo-M-L/openhand/security/advisories/new>
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
