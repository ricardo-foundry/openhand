import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import {
  runAudit,
  auditPlugin,
  scoreScope,
  bandForScore,
  renderAuditReport,
  type AuditablePlugin,
} from '../src/commands/audit';

function plugin(
  id: string,
  perms: string[],
  toolNames: string[] = [],
  enabled = true,
): AuditablePlugin {
  return {
    manifest: { id, version: '1.0.0', permissions: perms, description: `${id} plugin` },
    dir: `/fake/${id}`,
    enabled,
    module: { tools: toolNames.map(name => ({ name })) },
  };
}

test('scoreScope: known scopes use the documented weights', () => {
  assert.equal(scoreScope('network:http'), 4);
  assert.equal(scoreScope('shell:exec'), 8);
  assert.equal(scoreScope('llm:chat'), 1);
  assert.equal(scoreScope('sandbox:bypass'), 10);
});

test('scoreScope: unknown two-segment prefix matches', () => {
  // fs:write:/etc → falls back to fs:write (5)
  assert.equal(scoreScope('fs:write:/etc'), 5);
  // unknown vendor scope → 1 (visible but not dominant)
  assert.equal(scoreScope('vendor:something'), 1);
});

test('bandForScore: thresholds at 4 and 8', () => {
  assert.equal(bandForScore(0), 'low');
  assert.equal(bandForScore(3), 'low');
  assert.equal(bandForScore(4), 'medium');
  assert.equal(bandForScore(7), 'medium');
  assert.equal(bandForScore(8), 'high');
  assert.equal(bandForScore(99), 'high');
});

test('auditPlugin: aggregates score and sorts scopes', () => {
  const row = auditPlugin(plugin('web-scraper', ['network:http', 'llm:chat'], ['scrape_summary']));
  assert.equal(row.id, 'web-scraper');
  assert.deepEqual(row.scopes, ['llm:chat', 'network:http']);
  assert.equal(row.score, 4 + 1);
  assert.equal(row.band, 'medium');
  assert.deepEqual(row.toolNames, ['scrape_summary']);
});

test('auditPlugin: handles missing permissions array', () => {
  const row = auditPlugin(plugin('weather', [], []));
  assert.equal(row.scopes.length, 0);
  assert.equal(row.score, 0);
  assert.equal(row.band, 'low');
});

test('renderAuditReport: empty plugin list renders friendly placeholder', () => {
  const out = renderAuditReport([], '/tmp/oh');
  assert.match(out, /No plugins installed/);
  assert.match(out, /\/tmp\/oh/);
});

test('renderAuditReport: includes summary table and per-plugin sections', () => {
  const rows = [auditPlugin(plugin('a', ['shell:exec'])), auditPlugin(plugin('b', ['llm:chat']))];
  const out = renderAuditReport(rows, '/tmp/oh');
  assert.match(out, /## Summary/);
  assert.match(out, /## Details/);
  assert.match(out, /### a@1\.0\.0/);
  assert.match(out, /### b@1\.0\.0/);
  assert.match(out, /\| a \|/);
  assert.match(out, /\*\*high\*\*/); // a has shell:exec score=8 → high
});

test('runAudit: writes the report to outFile when provided', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-audit-'));
  try {
    const outFile = path.join(tmp, 'audit.md');
    let captured = '';
    const result = await runAudit(
      { outFile, pluginsDir: '/fake' },
      {
        loadPlugins: () => [plugin('calculator', [])],
        write: (s) => { captured += s; },
      },
    );
    assert.equal(result.code, 0);
    const onDisk = await fs.readFile(outFile, 'utf-8');
    assert.equal(captured, onDisk, 'stdout and outFile must be identical');
    assert.match(onDisk, /calculator@1\.0\.0/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('runAudit: rows are sorted highest-risk first, then by id', async () => {
  let captured = '';
  const result = await runAudit(
    { pluginsDir: '/fake' },
    {
      loadPlugins: () => [
        plugin('safe', []),                 // 0
        plugin('shellish', ['shell:exec']), // 8
        plugin('netty', ['network:http']),  // 4
      ],
      write: (s) => { captured += s; },
    },
  );
  assert.equal(result.rows[0]?.id, 'shellish');
  assert.equal(result.rows[1]?.id, 'netty');
  assert.equal(result.rows[2]?.id, 'safe');
  // Order in the rendered text matches.
  const idxShell = captured.indexOf('### shellish@');
  const idxNet = captured.indexOf('### netty@');
  const idxSafe = captured.indexOf('### safe@');
  assert.ok(idxShell < idxNet && idxNet < idxSafe);
});

test('runAudit: never throws on a plugin with no tools array', async () => {
  const result = await runAudit(
    { pluginsDir: '/fake' },
    {
      loadPlugins: () => [
        // Simulate a misshapen plugin: no tools at all.
        { manifest: { id: 'x', version: '1.0.0' }, dir: '/x', enabled: true, module: {} },
      ],
      write: () => {},
    },
  );
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0]?.toolNames, []);
});
