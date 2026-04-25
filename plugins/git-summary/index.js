// OpenHand Git Summary Plugin
//
// Takes a stretch of `git log` output and produces a structured PR / changelog
// block. Heavy lifting is delegated to the LLM, but the prompt + post-parse
// is a deterministic shape so callers can render it however they like.
//
// The plugin does not call out to git directly — that's the host's job. Pass
// us the raw text the user produced via:
//
//     git log v1.0.0..HEAD --pretty=format:'%h %s%n%b%n---'
//
// The plugin is provider-agnostic. `context.llm.complete()` is the only LLM
// dependency, so MockProvider, LLMClient (with retry), or any custom shim
// all work without changes.
//
// Tools exposed:
//   - git_summary(log, format?, audience?)  — calls LLM, returns { summary, sections, render }
//   - git_summary_stats(log)                — pure: parse commits, return counts
//
// `format` accepts `pr` (default) | `changelog` | `release`.
// `audience` optional: hints the tone, e.g. "engineers", "end-users".

'use strict';

const MAX_LOG_BYTES = 256 * 1024;
const DEFAULT_MODEL = 'gpt-4o-mini';

const FORMATS = Object.freeze({
  pr: { title: 'Pull Request Description', kind: 'pr' },
  changelog: { title: 'Changelog Entry', kind: 'changelog' },
  release: { title: 'Release Notes', kind: 'release' },
});

/**
 * Parse `git log` output into a list of commits with subject + body.
 * Tolerant — handles `--oneline`, the conventional `%h %s` shape, and
 * the `git log --pretty=format:'%h %s%n%b%n---'` separator we recommend.
 */
function parseLog(log) {
  if (typeof log !== 'string') throw new TypeError('log must be a string');
  if (log.length > MAX_LOG_BYTES) {
    throw new Error(`git log too large (${log.length} > ${MAX_LOG_BYTES} bytes)`);
  }

  const commits = [];
  // Strategy: split on the explicit `---\n` separator if present, else fall
  // back to one-commit-per-line (standard `git log --oneline` output).
  const blocks = log.includes('\n---')
    ? log.split(/\r?\n---\r?\n?/).map(s => s.trim()).filter(Boolean)
    : log.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const header = lines[0] || '';
    const body = lines.slice(1).join('\n').trim();
    const m = header.match(/^([0-9a-f]{7,40})\s+(.*)$/);
    if (!m) {
      // Not a recognisable commit line — skip silently rather than fail.
      continue;
    }
    const subject = m[2].trim();
    const conventional = subject.match(/^([a-z]+)(\([^)]+\))?(!?):\s*(.+)$/i);
    commits.push({
      hash: m[1].slice(0, 7),
      subject,
      body,
      type: conventional ? conventional[1].toLowerCase() : null,
      scope: conventional && conventional[2] ? conventional[2].slice(1, -1) : null,
      breaking: !!(conventional && (conventional[3] === '!' || /BREAKING CHANGE/.test(body))),
    });
  }

  // Bucket by conventional-commit type for the LLM's prompt context.
  const byType = {};
  for (const c of commits) {
    const k = c.type || 'other';
    if (!byType[k]) byType[k] = [];
    byType[k].push(c);
  }

  return {
    commits,
    totals: {
      commits: commits.length,
      breaking: commits.filter(c => c.breaking).length,
      types: Object.keys(byType).sort(),
    },
    byType,
  };
}

/**
 * Build the chat messages we send to the LLM for a given format.
 * Exported for auditability + tests.
 */
function buildMessages({ log, stats, format, audience }) {
  const fmt = FORMATS[format] || FORMATS.pr;
  const audienceLine = audience
    ? `Target audience: ${audience}.`
    : 'Target audience: engineers reviewing the change.';

  const schema = [
    'Output JSON ONLY. No prose. No code fences. Schema:',
    '{',
    '  "title": string,                          // 1-line punchy title',
    '  "summary": string,                        // 2-4 sentence what+why',
    '  "sections": [                             // 0..6',
    '    { "heading": string, "bullets": [string] }',
    '  ],',
    '  "breaking": [string],                     // 0..N notes for breaking changes',
    '  "callouts": [string]                      // 0..N security/perf/migration notes',
    '}',
  ].join('\n');

  const system = [
    `You are an experienced engineer drafting a ${fmt.title}.`,
    'You read git logs and produce a clear, factual summary.',
    'Group related commits into sections. Drop trivial chore/style commits',
    'unless that\'s all there is. Always call out breaking changes.',
    schema,
  ].join('\n');

  const summaryLine = `Commits: ${stats.totals.commits}, breaking: ${stats.totals.breaking}, types: ${stats.totals.types.join(', ') || '(none)'}.`;

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        audienceLine,
        summaryLine,
        '',
        'Raw git log:',
        '```',
        log,
        '```',
      ].join('\n'),
    },
  ];
}

/** Tolerant JSON extractor that copes with code fences and trailing prose. */
function parseSummary(raw) {
  if (!raw || typeof raw !== 'string') return fallbackSummary('empty LLM response');
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    return normalizeSummary(JSON.parse(s));
  } catch {
    return fallbackSummary('LLM returned non-JSON');
  }
}

function normalizeSummary(o) {
  const sections = Array.isArray(o?.sections) ? o.sections : [];
  return {
    title: typeof o?.title === 'string' ? o.title.trim() : '',
    summary: typeof o?.summary === 'string' ? o.summary.trim() : '',
    sections: sections.slice(0, 6).map(s => ({
      heading: typeof s?.heading === 'string' ? s.heading : '',
      bullets: Array.isArray(s?.bullets)
        ? s.bullets.filter(b => typeof b === 'string').slice(0, 30)
        : [],
    })),
    breaking: Array.isArray(o?.breaking)
      ? o.breaking.filter(b => typeof b === 'string').slice(0, 20)
      : [],
    callouts: Array.isArray(o?.callouts)
      ? o.callouts.filter(b => typeof b === 'string').slice(0, 10)
      : [],
  };
}

function fallbackSummary(reason) {
  return {
    title: '(no summary)',
    summary: `(no structured summary — ${reason})`,
    sections: [],
    breaking: [],
    callouts: [],
  };
}

/**
 * Render the structured summary as Markdown for direct paste into a PR / CHANGELOG.
 */
function renderMarkdown({ summary, stats, format }) {
  const fmt = FORMATS[format] || FORMATS.pr;
  const lines = [];
  if (summary.title) lines.push(`# ${summary.title}`);
  else lines.push(`# ${fmt.title}`);
  lines.push('');
  lines.push(`_${stats.totals.commits} commit(s)${stats.totals.breaking ? `, ${stats.totals.breaking} breaking` : ''}._`);
  lines.push('');
  if (summary.summary) {
    lines.push('## Summary');
    lines.push(summary.summary);
    lines.push('');
  }
  for (const section of summary.sections) {
    if (!section.heading && section.bullets.length === 0) continue;
    lines.push(`## ${section.heading || 'Changes'}`);
    for (const b of section.bullets) lines.push(`- ${b}`);
    lines.push('');
  }
  if (summary.breaking.length > 0) {
    lines.push('## ⚠ Breaking Changes');
    for (const b of summary.breaking) lines.push(`- ${b}`);
    lines.push('');
  }
  if (summary.callouts.length > 0) {
    lines.push('## Notes');
    for (const c of summary.callouts) lines.push(`- ${c}`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

/** End-to-end: parse log → ask LLM → render Markdown. */
async function runSummary({ log, format, audience, llm, model }) {
  const stats = parseLog(log);
  if (!llm || typeof llm.complete !== 'function') {
    throw new TypeError('runSummary: llm.complete() is required');
  }
  const fmtKey = (format && FORMATS[format]) ? format : 'pr';
  const res = await llm.complete({
    model: model || DEFAULT_MODEL,
    messages: buildMessages({ log, stats, format: fmtKey, audience }),
    temperature: 0.2,
    maxTokens: 800,
  });
  const summary = parseSummary(res && res.content);
  const render = renderMarkdown({ summary, stats, format: fmtKey });
  return { summary, stats, render, format: fmtKey };
}

module.exports = {
  name: 'git-summary',
  version: '1.0.0',
  description: 'Turn a git log into a PR description, changelog entry, or release notes.',

  parseLog,
  buildMessages,
  parseSummary,
  renderMarkdown,
  runSummary,

  tools: [
    {
      name: 'git_summary',
      description:
        'Summarise a stretch of `git log` output into a PR description, changelog entry, or release notes.',
      parameters: [
        { name: 'log', type: 'string', description: 'Raw git log text', required: true },
        { name: 'format', type: 'string', description: 'pr | changelog | release', required: false, default: 'pr' },
        { name: 'audience', type: 'string', description: 'Optional audience hint (e.g. "end-users")', required: false },
      ],
      permissions: ['llm:chat'],
      sandboxRequired: false,
      async execute(params, context) {
        const llm = context && context.llm;
        if (!llm) throw new Error('git_summary requires context.llm');
        return await runSummary({
          log: params.log,
          format: params.format,
          audience: params.audience,
          llm,
          model: params.model,
        });
      },
    },
    {
      name: 'git_summary_stats',
      description: 'Parse a git log and return commit counts and conventional-commit types. No LLM call.',
      parameters: [
        { name: 'log', type: 'string', description: 'Raw git log text', required: true },
      ],
      permissions: [],
      sandboxRequired: false,
      async execute(params) {
        return parseLog(params.log);
      },
    },
  ],

  async onEnable() {
    // stateless
  },
};
