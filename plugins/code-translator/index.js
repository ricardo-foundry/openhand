// OpenHand Code Translator Plugin
//
// Takes a code snippet plus a target language, asks the host LLM to translate
// it, and returns the translated source. Provider-agnostic: like every other
// in-tree plugin, it expects the host to inject `context.llm` (anything with
// a `.complete({ model, messages }) -> { content }` shape — `MockProvider`
// works).
//
// Why a dedicated plugin and not just "ask the agent"?
//   1. We can apply a *secret-leak heuristic* at the plugin boundary, before
//      the snippet ever leaves the host. That keeps an unobservant caller
//      from accidentally shipping `OPENAI_API_KEY=sk-...` to a third-party
//      LLM. Heuristic only — defence in depth, not a replacement for code
//      review.
//   2. We can normalise language names (`py` → `python`, `JS` → `javascript`)
//      and whitelist them so the model isn't asked to "translate to /etc/passwd".
//   3. We can strip surrounding ``` fences from the response so the agent
//      gets compileable text instead of a markdown blob.
//
// Exposed tools:
//   - code_translate(source, source_lang?, target_lang)  — full translate
//   - code_scan_secrets(source)                          — pure heuristic, no LLM
//
// Hard limits:
//   - 64 KiB max source size (anything bigger should be chunked).
//   - 8 supported target languages (whitelist below).
//   - Aborts immediately on secret heuristic match.

'use strict';

const MAX_SOURCE_BYTES = 64 * 1024;
const DEFAULT_MODEL = 'gpt-4o-mini';

// Whitelist of language ids we'll prompt the model with. Aliases on the right
// of the colon collapse to the canonical name on the left.
const LANG_ALIASES = Object.freeze({
  python: ['python', 'py', 'python3'],
  javascript: ['javascript', 'js', 'node', 'nodejs'],
  typescript: ['typescript', 'ts'],
  go: ['go', 'golang'],
  rust: ['rust', 'rs'],
  java: ['java'],
  ruby: ['ruby', 'rb'],
  csharp: ['csharp', 'c#', 'cs', 'dotnet'],
});

const CANONICAL_BY_ALIAS = (() => {
  const map = new Map();
  for (const [canon, aliases] of Object.entries(LANG_ALIASES)) {
    for (const a of aliases) map.set(a.toLowerCase(), canon);
  }
  return map;
})();

/**
 * Resolve a free-form language string to one of our 8 supported languages.
 * Throws on unknown — fail closed rather than silently send the wrong target.
 */
function resolveLanguage(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('language is required');
  }
  const key = input.trim().toLowerCase();
  const canon = CANONICAL_BY_ALIAS.get(key);
  if (!canon) {
    const supported = Object.keys(LANG_ALIASES).join(', ');
    throw new Error(`unsupported language: "${input}" (supported: ${supported})`);
  }
  return canon;
}

/**
 * Heuristic secret detector. Pure regex over the source — fast, no I/O. We
 * tune for low false-negatives on common providers (OpenAI, AWS, GitHub,
 * Slack, Stripe, generic API_KEY/SECRET=...) and accept some false positives
 * (better to refuse and let the user redact than leak).
 *
 * Returns an array of `{ kind, line, snippet }`. Empty array means clean.
 */
function scanForSecrets(source) {
  if (typeof source !== 'string') {
    throw new TypeError('source must be a string');
  }
  const findings = [];
  const lines = source.split(/\r?\n/);

  // Each entry: kind label + a regex. We deliberately skip the prose-y
  // "secret" word — too many false positives in code comments. The token
  // patterns are what catch real keys.
  const PATTERNS = [
    { kind: 'openai_api_key',   re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
    { kind: 'aws_access_key',   re: /\bAKIA[0-9A-Z]{16}\b/ },
    { kind: 'aws_secret_key',   re: /\b[A-Za-z0-9/+]{40}\b(?=.*aws)/i }, // crude
    { kind: 'github_token',     re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
    { kind: 'slack_token',      re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
    { kind: 'stripe_key',       re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/ },
    { kind: 'private_key_pem',  re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/ },
    // Catch-alls for assignments. Keep these last so a more specific match wins.
    { kind: 'api_key_assignment',    re: /\b(?:API_KEY|APIKEY|API-KEY)\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{16,}/i },
    { kind: 'secret_assignment',     re: /\b(?:SECRET|SECRET_KEY|CLIENT_SECRET|AUTH_TOKEN|ACCESS_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{12,}/i },
    { kind: 'password_assignment',   re: /\b(?:PASSWORD|PASSWD)\s*[:=]\s*["'][^"']{6,}["']/i },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { kind, re } of PATTERNS) {
      const m = line.match(re);
      if (m) {
        findings.push({
          kind,
          line: i + 1,
          // truncate so we never echo the whole secret back
          snippet: redact(m[0]),
        });
        break; // one finding per line is plenty
      }
    }
  }
  return findings;
}

/**
 * Replace the middle of a matched string with `…` so we never log a key in
 * full. Keeps the first 4 and last 4 chars for triage; if shorter, full mask.
 */
function redact(s) {
  if (s.length <= 12) return s.replace(/./g, '*');
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * Strip a single layer of ``` fences from an LLM response. Idempotent on
 * already-clean output. We do this so callers downstream can paste the
 * result straight into a file.
 */
function stripFence(text) {
  if (typeof text !== 'string') return '';
  const t = text.trim();
  // ```lang\n...\n```  or  ```\n...\n```
  const m = t.match(/^```[a-zA-Z0-9_+-]*\n([\s\S]*?)\n```$/);
  if (m) return m[1] ?? '';
  return t;
}

function buildPrompt({ source, sourceLang, targetLang }) {
  const sysSrc = sourceLang ? `from ${sourceLang}` : 'from its source language';
  return [
    {
      role: 'system',
      content:
        `You are a code translator. Translate the user-provided code ${sysSrc} ` +
        `to ${targetLang}. Preserve behaviour and idioms. Do not invent imports ` +
        `that don't exist in ${targetLang}. Do not include explanations — return ` +
        `only the translated code, optionally wrapped in a single \`\`\`${targetLang} fence.`,
    },
    { role: 'user', content: source },
  ];
}

async function translate(params, context) {
  const source = params && typeof params.source === 'string' ? params.source : '';
  if (source.length === 0) throw new Error('source is required');
  if (Buffer.byteLength(source, 'utf-8') > MAX_SOURCE_BYTES) {
    throw new Error(`source too large (max ${MAX_SOURCE_BYTES} bytes)`);
  }

  const targetLang = resolveLanguage(params.target_lang ?? params.targetLang ?? '');
  const sourceLang = params.source_lang || params.sourceLang
    ? resolveLanguage(params.source_lang ?? params.sourceLang)
    : null;

  const findings = scanForSecrets(source);
  if (findings.length > 0) {
    const err = new Error(
      `refusing to translate: source appears to contain secrets ` +
      `(${findings.length} finding${findings.length === 1 ? '' : 's'}). ` +
      `Redact and retry. Kinds: ${[...new Set(findings.map(f => f.kind))].join(', ')}`,
    );
    err.code = 'SECRET_DETECTED';
    err.findings = findings;
    throw err;
  }

  const llm = context && context.llm;
  if (!llm || typeof llm.complete !== 'function') {
    throw new Error('LLM client not available in context');
  }

  const messages = buildPrompt({ source, sourceLang, targetLang });
  const model = params.model || DEFAULT_MODEL;
  const response = await llm.complete({ model, messages });
  const raw = (response && response.content) || '';
  const translated = stripFence(raw);
  return {
    target_lang: targetLang,
    source_lang: sourceLang,
    model,
    translated,
    bytes_in: source.length,
    bytes_out: translated.length,
  };
}

module.exports = {
  name: 'code-translator',
  version: '1.0.0',
  description: 'Translate code between languages via the host LLM, with secret-leak heuristics.',

  // Exported for direct testing.
  scanForSecrets,
  resolveLanguage,
  stripFence,

  tools: [
    {
      name: 'code_translate',
      description: 'Translate a code snippet to a target language. Refuses snippets that match a secret heuristic.',
      parameters: [
        { name: 'source',      type: 'string', description: 'Source code to translate', required: true },
        { name: 'target_lang', type: 'string', description: 'Target language (python|javascript|typescript|go|rust|java|ruby|csharp)', required: true },
        { name: 'source_lang', type: 'string', description: 'Optional source language hint', required: false },
        { name: 'model',       type: 'string', description: `Optional model id (default: ${DEFAULT_MODEL})`, required: false },
      ],
      permissions: ['llm:complete'],
      sandboxRequired: false,
      execute: translate,
    },
    {
      name: 'code_scan_secrets',
      description: 'Run the secret heuristic over a snippet without translating. Returns { findings: [...] }.',
      parameters: [
        { name: 'source', type: 'string', description: 'Code to scan', required: true },
      ],
      permissions: [],
      sandboxRequired: false,
      async execute(params) {
        const findings = scanForSecrets(params && params.source ? String(params.source) : '');
        return { findings, clean: findings.length === 0 };
      },
    },
  ],

  async onEnable() {
    /* nothing to warm */
  },
};
