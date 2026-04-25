'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../index.js');

// Sample log using `--pretty=format:'%h %s%n%b%n---'` style.
const STRUCTURED_LOG = [
  'abc1234 feat(api): add /v2/search endpoint',
  '',
  'Adds a new search route backed by Postgres FTS.',
  '---',
  'def5678 fix(parser): handle CRLF correctly',
  '',
  '---',
  '9abcdef chore(deps): bump typescript to 5.4',
  '',
  '---',
  'cafe001 feat!: drop legacy /v1 routes',
  '',
  'BREAKING CHANGE: callers must migrate to /v2.',
  '---',
].join('\n');

const ONELINE_LOG = [
  'abc1234 feat(api): add /v2/search endpoint',
  'def5678 fix(parser): handle CRLF correctly',
  '9abcdef chore(deps): bump typescript to 5.4',
].join('\n');

// 1. parseLog handles the structured (`---`-separated) log.
test('parseLog: structured log → 4 commits with body kept', () => {
  const stats = plugin.parseLog(STRUCTURED_LOG);
  assert.equal(stats.totals.commits, 4);
  assert.equal(stats.commits[0].hash, 'abc1234');
  assert.equal(stats.commits[0].subject, 'feat(api): add /v2/search endpoint');
  assert.match(stats.commits[0].body, /Postgres FTS/);
  assert.equal(stats.commits[0].type, 'feat');
  assert.equal(stats.commits[0].scope, 'api');
  assert.equal(stats.commits[0].breaking, false);
});

// 2. parseLog handles plain `--oneline` output.
test('parseLog: --oneline output also parses', () => {
  const stats = plugin.parseLog(ONELINE_LOG);
  assert.equal(stats.totals.commits, 3);
  assert.equal(stats.commits[1].hash, 'def5678');
  assert.equal(stats.commits[1].type, 'fix');
});

// 3. Breaking change detection (both `feat!:` and `BREAKING CHANGE` body).
test('parseLog: breaking-change detection covers `!:` and body marker', () => {
  const stats = plugin.parseLog(STRUCTURED_LOG);
  const breaking = stats.commits.filter(c => c.breaking);
  assert.equal(breaking.length, 1);
  assert.equal(breaking[0].hash, 'cafe001');
  assert.equal(stats.totals.breaking, 1);
});

// 4. parseLog rejects oversized input.
test('parseLog: oversized input throws', () => {
  const huge = 'a'.repeat(257 * 1024);
  assert.throws(() => plugin.parseLog(huge), /git log too large/);
});

// 5. buildMessages includes the schema and the totals.
test('buildMessages: schema + totals are present in system+user', () => {
  const stats = plugin.parseLog(STRUCTURED_LOG);
  const msgs = plugin.buildMessages({
    log: STRUCTURED_LOG,
    stats,
    format: 'changelog',
    audience: 'end-users',
  });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /Changelog Entry/);
  assert.match(msgs[0].content, /JSON ONLY/);
  assert.match(msgs[1].content, /end-users/);
  assert.match(msgs[1].content, /Commits: 4/);
  assert.match(msgs[1].content, /breaking: 1/);
});

// 6. parseSummary tolerates code fences + trailing prose, normalises clamp.
test('parseSummary: code fences + trailing prose still produce valid object', () => {
  const raw = '```json\n{"title":"OK","sections":[{"heading":"a","bullets":["x","y"]}]}\n```\nthanks!';
  const out = plugin.parseSummary(raw);
  assert.equal(out.title, 'OK');
  assert.equal(out.sections.length, 1);
  assert.deepEqual(out.sections[0].bullets, ['x', 'y']);
  assert.deepEqual(out.breaking, []);
});

test('parseSummary: garbage falls back, does not throw', () => {
  const out = plugin.parseSummary('this is not json at all');
  assert.match(out.summary, /no structured summary/);
});

// 7. renderMarkdown picks the right title and surfaces breaking notes.
test('renderMarkdown: includes breaking section when present', () => {
  const stats = plugin.parseLog(STRUCTURED_LOG);
  const md = plugin.renderMarkdown({
    summary: {
      title: 'v1.2 highlights',
      summary: 'New search and a few fixes.',
      sections: [{ heading: 'Features', bullets: ['/v2/search'] }],
      breaking: ['v1 routes removed'],
      callouts: [],
    },
    stats,
    format: 'release',
  });
  assert.match(md, /^# v1\.2 highlights/);
  assert.match(md, /4 commit\(s\), 1 breaking/);
  assert.match(md, /## ⚠ Breaking Changes/);
  assert.match(md, /v1 routes removed/);
});

// 8. End-to-end runSummary uses an injected fake `llm` and returns render text.
test('runSummary: uses context.llm.complete and returns render Markdown', async () => {
  const fakeLLM = {
    async complete(req) {
      assert.equal(req.model, 'gpt-4o-mini');
      assert.equal(req.messages.length, 2);
      return {
        content: JSON.stringify({
          title: 'Search API + cleanup',
          summary: 'Adds /v2/search; deprecates /v1.',
          sections: [
            { heading: 'Features', bullets: ['/v2/search'] },
            { heading: 'Fixes', bullets: ['CRLF parser'] },
          ],
          breaking: ['Drops /v1 routes'],
          callouts: ['Bump TypeScript to 5.4'],
        }),
      };
    },
  };
  const result = await plugin.runSummary({ log: STRUCTURED_LOG, llm: fakeLLM });
  assert.equal(result.format, 'pr');
  assert.equal(result.summary.title, 'Search API + cleanup');
  assert.match(result.render, /## Features/);
  assert.match(result.render, /## ⚠ Breaking Changes/);
});

// Extra sanity: tool wiring matches what plugin.list expects.
test('manifest: exposes git_summary + git_summary_stats tools', () => {
  assert.equal(plugin.tools.length, 2);
  const names = plugin.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['git_summary', 'git_summary_stats']);
  // Sandbox is not required (the plugin doesn't shell out).
  for (const t of plugin.tools) {
    assert.equal(t.sandboxRequired, false);
  }
});
