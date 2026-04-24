// OpenHand Code Reviewer Plugin
//
// Takes a unified diff ("git diff" output), asks the LLM to score it across
// a handful of axes, and renders a Markdown report.
//
// The plugin is provider-agnostic: it doesn't import @openhand/llm. Instead,
// the host passes a `complete({ model, messages }) -> { content }` callable
// through `context.llm`. The unit tests feed in a fake that returns canned
// JSON, which is exactly what happens with `MockProvider` in practice.
//
// Exposed tools:
//   - code_review(diff, focus?)  — structured review (calls LLM)
//   - code_review_stats(diff)    — diff stats (pure, no LLM)

'use strict';

const MAX_DIFF_BYTES = 256 * 1024; // 256 KiB — anything bigger should be chunked.
const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Parse a unified diff and return per-file add/remove counts, plus a hunk
 * count. Pure; used both by `code_review_stats` and as context for the LLM.
 */
function parseDiff(diff) {
  if (typeof diff !== 'string') {
    throw new TypeError('diff must be a string');
  }
  if (diff.length > MAX_DIFF_BYTES) {
    throw new Error(`diff too large (${diff.length} > ${MAX_DIFF_BYTES} bytes)`);
  }

  const files = [];
  let current = null;
  let totalAdd = 0;
  let totalDel = 0;
  let hunks = 0;

  const lines = diff.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      // `diff --git a/foo b/foo` — take the "b/" side for the final name.
      const m = line.match(/ b\/(.+)$/);
      current = {
        path: m ? m[1] : '(unknown)',
        additions: 0,
        deletions: 0,
        hunks: 0,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('@@')) {
      current.hunks += 1;
      hunks += 1;
      continue;
    }
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (line.startsWith('+')) {
      current.additions += 1;
      totalAdd += 1;
    } else if (line.startsWith('-')) {
      current.deletions += 1;
      totalDel += 1;
    }
  }
  if (current) files.push(current);

  return {
    files,
    totals: {
      files: files.length,
      additions: totalAdd,
      deletions: totalDel,
      hunks,
    },
  };
}

/**
 * Build the chat messages we send to the LLM. Separated so the exact prompt
 * is auditable and testable.
 */
function buildMessages(diff, stats, focus) {
  const focusLine = focus
    ? `Reviewer focus: ${focus}.`
    : 'Reviewer focus: correctness, safety, readability, tests.';
  const summary =
    `Diff stats: ${stats.totals.files} file(s), ` +
    `${stats.totals.additions}+ / ${stats.totals.deletions}-, ` +
    `${stats.totals.hunks} hunk(s).`;
  return [
    {
      role: 'system',
      content: [
        'You are an experienced senior engineer performing a code review.',
        'You output JSON ONLY, no prose, no code fences.',
        'Schema:',
        '{',
        '  "summary": string,           // 1-3 sentences',
        '  "verdict": "approve"|"request-changes"|"comment",',
        '  "scores": {                  // integer 1..5, higher = better',
        '    "correctness": number,',
        '    "safety": number,',
        '    "readability": number,',
        '    "tests": number',
        '  },',
        '  "findings": [                // 0..10 entries',
        '    { "severity": "info"|"minor"|"major"|"blocker",',
        '      "file": string,',
        '      "message": string }',
        '  ]',
        '}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [focusLine, summary, '', 'Unified diff:', '```diff', diff, '```'].join('\n'),
    },
  ];
}

/**
 * Tolerant JSON parser. Strips code fences the LLM sometimes insists on,
 * tolerates trailing prose, and falls back to the empty report shape on
 * garbage input so a bad completion doesn't crash the whole plugin.
 */
function parseReview(raw) {
  if (!raw || typeof raw !== 'string') return fallbackReview('empty LLM response');
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    const parsed = JSON.parse(s);
    return normalizeReview(parsed);
  } catch {
    return fallbackReview('LLM returned non-JSON');
  }
}

function normalizeReview(r) {
  const scores = r && r.scores ? r.scores : {};
  const findings = Array.isArray(r && r.findings) ? r.findings : [];
  const verdict = ['approve', 'request-changes', 'comment'].includes(r?.verdict)
    ? r.verdict
    : 'comment';
  return {
    summary: typeof r?.summary === 'string' ? r.summary : '',
    verdict,
    scores: {
      correctness: clampScore(scores.correctness),
      safety: clampScore(scores.safety),
      readability: clampScore(scores.readability),
      tests: clampScore(scores.tests),
    },
    findings: findings.slice(0, 20).map(f => ({
      severity: ['info', 'minor', 'major', 'blocker'].includes(f?.severity)
        ? f.severity
        : 'info',
      file: typeof f?.file === 'string' ? f.file : '',
      message: typeof f?.message === 'string' ? f.message : '',
    })),
  };
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 3;
  return Math.max(1, Math.min(5, Math.round(v)));
}

function fallbackReview(reason) {
  return {
    summary: `(no structured review — ${reason})`,
    verdict: 'comment',
    scores: { correctness: 3, safety: 3, readability: 3, tests: 3 },
    findings: [],
  };
}

/**
 * Render a review + stats bundle into Markdown suitable for pasting into
 * a PR comment.
 */
function renderReport({ review, stats, focus }) {
  const lines = [];
  lines.push('# Code Review Report');
  lines.push('');
  lines.push(`**Verdict:** \`${review.verdict}\``);
  if (focus) lines.push(`**Focus:** ${focus}`);
  lines.push('');
  lines.push(
    `**Stats:** ${stats.totals.files} file(s), ` +
      `${stats.totals.additions}+ / ${stats.totals.deletions}-, ` +
      `${stats.totals.hunks} hunk(s).`,
  );
  lines.push('');
  if (review.summary) {
    lines.push('## Summary');
    lines.push(review.summary);
    lines.push('');
  }
  lines.push('## Scores (1-5)');
  lines.push('');
  lines.push('| Axis          | Score |');
  lines.push('|---------------|-------|');
  lines.push(`| Correctness   | ${review.scores.correctness} |`);
  lines.push(`| Safety        | ${review.scores.safety} |`);
  lines.push(`| Readability   | ${review.scores.readability} |`);
  lines.push(`| Tests         | ${review.scores.tests} |`);
  lines.push('');
  if (review.findings.length > 0) {
    lines.push('## Findings');
    lines.push('');
    for (const f of review.findings) {
      const loc = f.file ? ` \`${f.file}\`` : '';
      lines.push(`- **${f.severity}**${loc}: ${f.message}`);
    }
  } else {
    lines.push('## Findings');
    lines.push('');
    lines.push('_No findings._');
  }
  if (stats.files.length > 0) {
    lines.push('');
    lines.push('## Files touched');
    lines.push('');
    lines.push('| File | +  | -  | Hunks |');
    lines.push('|------|----|----|-------|');
    for (const f of stats.files) {
      lines.push(`| \`${f.path}\` | ${f.additions} | ${f.deletions} | ${f.hunks} |`);
    }
  }
  return lines.join('\n');
}

/**
 * Run a full review. `llm` may be `MockProvider`, a real `LLMClient`, or
 * any object with `.complete({ model, messages }) -> { content }`.
 */
async function runReview({ diff, focus, llm, model }) {
  const stats = parseDiff(diff);
  if (!llm || typeof llm.complete !== 'function') {
    throw new TypeError('runReview: llm.complete() is required');
  }
  const res = await llm.complete({
    model: model || DEFAULT_MODEL,
    messages: buildMessages(diff, stats, focus),
    temperature: 0.1,
    maxTokens: 800,
  });
  const review = parseReview(res && res.content);
  const report = renderReport({ review, stats, focus });
  return { review, stats, report };
}

module.exports = {
  name: 'code-reviewer',
  version: '1.0.0',
  description: 'Turn a unified diff into a structured LLM-powered review.',

  parseDiff,
  buildMessages,
  parseReview,
  renderReport,
  runReview,

  tools: [
    {
      name: 'code_review',
      description:
        'Review a unified diff with the LLM. Returns { review, stats, report (Markdown) }.',
      parameters: [
        { name: 'diff', type: 'string', description: 'Unified diff text', required: true },
        { name: 'focus', type: 'string', description: 'What to emphasise', required: false },
      ],
      permissions: ['llm:chat'],
      sandboxRequired: false,
      async execute(params, context) {
        const llm = context && context.llm;
        if (!llm) throw new Error('code_review requires context.llm');
        return await runReview({
          diff: params.diff,
          focus: params.focus,
          llm,
          model: params.model,
        });
      },
    },
    {
      name: 'code_review_stats',
      description: 'Parse a unified diff and return file/line counts. No LLM call.',
      parameters: [
        { name: 'diff', type: 'string', description: 'Unified diff text', required: true },
      ],
      permissions: [],
      sandboxRequired: false,
      async execute(params) {
        return parseDiff(params.diff);
      },
    },
  ],

  async onEnable() {
    // stateless
  },
};
