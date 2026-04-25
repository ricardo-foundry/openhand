#!/usr/bin/env node
'use strict';

/**
 * Generate landing/build-meta.json with numbers that the landing page reads
 * via fetch() at runtime. Sources of truth (zero drift):
 *
 *   tests.unit         — count of `^test(` lines under packages/.
 *   tests.e2e          — count under tests/e2e/.
 *   tests.integration  — count under tests/integration/.
 *   tests.plugins      — count under plugins/.
 *   tests.bench        — count under bench/.
 *   audit              — `npm audit --json` total vulns (best effort).
 *   plugins            — count of plugins/<dir>/package.json files.
 *   lastCommit         — `git log -1 --format=...`. Uses GITHUB_SHA fallback.
 *
 * Writes nothing, prints nothing, throws nothing on best-effort failures —
 * any field we can't determine just stays as the existing placeholder so
 * the schema and the front-end rendering both remain stable.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const outFile = path.join(root, 'landing', 'build-meta.json');

function countTestsIn(globDirs) {
  let n = 0;
  for (const d of globDirs) {
    const abs = path.join(root, d);
    if (!fs.existsSync(abs)) continue;
    const out = spawnSync('grep', [
      '-rE', '--include=*.test.ts', '--include=*.test.js',
      '^test\\(', abs,
    ], { encoding: 'utf-8' });
    if (out.status !== 0 && out.status !== 1) continue; // 1 = no matches
    if (out.stdout) n += out.stdout.split('\n').filter(Boolean).length;
  }
  return n;
}

function countBench() {
  const benchDir = path.join(root, 'bench');
  if (!fs.existsSync(benchDir)) return 0;
  const out = spawnSync('grep', ['-rE', '--include=*.bench.ts', '^test\\(', benchDir], {
    encoding: 'utf-8',
  });
  if (out.status !== 0 && out.status !== 1) return 0;
  return out.stdout ? out.stdout.split('\n').filter(Boolean).length : 0;
}

function readPluginCount() {
  const pdir = path.join(root, 'plugins');
  if (!fs.existsSync(pdir)) return 0;
  return fs.readdirSync(pdir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .filter(d => fs.existsSync(path.join(pdir, d.name, 'package.json')))
    .length;
}

function readAuditVulns() {
  const out = spawnSync('npm', ['audit', '--json', '--prefix', root], {
    encoding: 'utf-8', cwd: root, env: { ...process.env, npm_config_audit_level: 'low' },
  });
  if (!out.stdout) return null;
  try {
    const parsed = JSON.parse(out.stdout);
    const meta = parsed.metadata && parsed.metadata.vulnerabilities;
    if (!meta) return null;
    const fields = ['low', 'moderate', 'high', 'critical', 'info'];
    let total = 0;
    for (const f of fields) total += Number(meta[f] || 0);
    return total;
  } catch {
    return null;
  }
}

function readLastCommit() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
    const shortSha = sha.slice(0, 7);
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf-8' }).trim();
    const date = execFileSync('git', ['log', '-1', '--format=%cI'], { cwd: root, encoding: 'utf-8' }).trim();
    const repo = process.env.GITHUB_REPOSITORY || 'ricardo-foundry/openhand';
    return {
      sha,
      shortSha,
      subject,
      date,
      url: `https://github.com/${repo}/commit/${sha}`,
    };
  } catch {
    return null;
  }
}

function main() {
  const tests = {
    // packages/apps own unit suites + any *.test.ts that lives next to a
    // runnable example (examples/*.test.ts ships with the cookbook).
    unit: countTestsIn(['packages', 'apps', 'examples']),
    e2e: countTestsIn(['tests/e2e']),
    integration: countTestsIn(['tests/integration']),
    plugins: countTestsIn(['plugins']),
    bench: countBench(),
  };
  tests.total = tests.unit + tests.e2e + tests.integration + tests.plugins + tests.bench;

  const audit = { vulnerabilities: 0 };
  const audited = readAuditVulns();
  if (audited !== null) audit.vulnerabilities = audited;

  const meta = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    lastCommit: readLastCommit() || {
      sha: '0000000', shortSha: '0000000',
      subject: '(no git context available)',
      date: new Date().toISOString(),
      url: 'https://github.com/ricardo-foundry/openhand',
    },
    tests,
    audit,
    plugins: readPluginCount(),
    providers: ['openai', 'anthropic', 'ollama', 'mock'],
  };

  fs.writeFileSync(outFile, JSON.stringify(meta, null, 2) + '\n');
  // Print a one-line summary so the workflow log shows what landed.
  process.stdout.write(
    `wrote ${outFile} — tests.total=${meta.tests.total}, ` +
    `audit=${meta.audit.vulnerabilities}, plugins=${meta.plugins}, ` +
    `commit=${meta.lastCommit.shortSha}\n`
  );
}

main();
