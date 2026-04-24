'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../index.js');

const SAMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 export function foo() {
-  return 1;
+  return 2;
+  // new branch
 }
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -10,2 +10,3 @@
 const x = 1;
+const y = 2;
 const z = 3;
`;

test('parseDiff collects per-file additions/deletions/hunks', () => {
  const { files, totals } = plugin.parseDiff(SAMPLE_DIFF);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'src/a.ts');
  assert.equal(files[0].additions, 2);
  assert.equal(files[0].deletions, 1);
  assert.equal(files[0].hunks, 1);
  assert.equal(files[1].path, 'src/b.ts');
  assert.equal(files[1].additions, 1);
  assert.equal(files[1].deletions, 0);
  assert.deepEqual(totals, {
    files: 2,
    additions: 3,
    deletions: 1,
    hunks: 2,
  });
});

test('parseDiff rejects non-strings and oversized input', () => {
  assert.throws(() => plugin.parseDiff(null), /must be a string/);
  const huge = 'x'.repeat(400 * 1024);
  assert.throws(() => plugin.parseDiff(huge), /too large/);
});

test('buildMessages embeds stats and focus in the prompt', () => {
  const stats = plugin.parseDiff(SAMPLE_DIFF);
  const msgs = plugin.buildMessages(SAMPLE_DIFF, stats, 'null-safety');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /JSON ONLY/);
  assert.match(msgs[1].content, /null-safety/);
  assert.match(msgs[1].content, /2 file\(s\), 3\+ \/ 1-, 2 hunk\(s\)/);
});

test('parseReview tolerates code fences, prose, and bad JSON', () => {
  const good = `\`\`\`json
{"summary":"ok","verdict":"approve","scores":{"correctness":4,"safety":5,"readability":4,"tests":3},"findings":[]}
\`\`\``;
  const r1 = plugin.parseReview(good);
  assert.equal(r1.verdict, 'approve');
  assert.equal(r1.scores.correctness, 4);

  const prose = `Sure, here's the review:
{"summary":"meh","verdict":"weird","scores":{"correctness":99,"safety":-1},"findings":[{"severity":"nuclear","file":"x","message":"m"}]}
thanks!`;
  const r2 = plugin.parseReview(prose);
  assert.equal(r2.verdict, 'comment'); // unknown -> default
  assert.equal(r2.scores.correctness, 5); // clamped
  assert.equal(r2.scores.safety, 1);
  assert.equal(r2.findings[0].severity, 'info'); // unknown -> default

  const garbage = plugin.parseReview('this is not json at all');
  assert.equal(garbage.verdict, 'comment');
  assert.match(garbage.summary, /non-JSON/);
});

test('runReview drives a fake LLM end-to-end', async () => {
  const fakeLlm = {
    calls: 0,
    async complete(req) {
      this.calls++;
      assert.equal(req.model, 'my-model');
      assert.equal(req.messages.length, 2);
      return {
        content: JSON.stringify({
          summary: 'LGTM with a nit',
          verdict: 'approve',
          scores: { correctness: 5, safety: 4, readability: 4, tests: 3 },
          findings: [
            { severity: 'minor', file: 'src/a.ts', message: 'add a test for the new branch' },
          ],
        }),
      };
    },
  };
  const out = await plugin.runReview({
    diff: SAMPLE_DIFF,
    focus: 'tests',
    llm: fakeLlm,
    model: 'my-model',
  });
  assert.equal(fakeLlm.calls, 1);
  assert.equal(out.review.verdict, 'approve');
  assert.equal(out.stats.totals.files, 2);
  assert.match(out.report, /^# Code Review Report/);
  assert.match(out.report, /Verdict:\*\* `approve`/);
  assert.match(out.report, /add a test for the new branch/);
});

test('renderReport produces a deterministic Markdown layout', () => {
  const stats = plugin.parseDiff(SAMPLE_DIFF);
  const review = {
    summary: 'nothing major',
    verdict: 'comment',
    scores: { correctness: 4, safety: 5, readability: 4, tests: 2 },
    findings: [],
  };
  const md = plugin.renderReport({ review, stats });
  assert.match(md, /## Scores \(1-5\)/);
  assert.match(md, /\| Correctness   \| 4 \|/);
  assert.match(md, /_No findings\._/);
  assert.match(md, /## Files touched/);
  assert.match(md, /\| `src\/a\.ts` \| 2 \| 1 \| 1 \|/);
});

test('plugin manifest declares both tools with correct permissions', () => {
  const names = plugin.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['code_review', 'code_review_stats']);
  const review = plugin.tools.find(t => t.name === 'code_review');
  assert.deepEqual(review.permissions, ['llm:chat']);
  const stats = plugin.tools.find(t => t.name === 'code_review_stats');
  assert.deepEqual(stats.permissions, []);
});
