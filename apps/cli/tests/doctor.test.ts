import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runDiagnostics,
  renderMarkdown,
  runDoctor,
  REQUIRED_NODE_MAJOR,
  type DoctorInput,
  type RunDoctorDeps,
} from '../src/commands/doctor';
import { DEFAULT_REPL_CONFIG, type ReplConfig } from '../src/repl';

const BASE_INPUT: DoctorInput = {
  nodeVersion: '20.10.0',
  platform: 'darwin',
  arch: 'arm64',
  config: DEFAULT_REPL_CONFIG,
  sandboxPaths: ['/home/me', '/tmp'],
  workspacePackages: [
    { name: '@openhand/core', resolved: true, version: '0.7.0' },
    { name: '@openhand/llm', resolved: true, version: '0.7.0' },
  ],
  nodeModulesExists: true,
  pluginCount: 7,
};

test('runDiagnostics on a healthy env returns all-ok summary', () => {
  const r = runDiagnostics({
    ...BASE_INPUT,
    config: { ...DEFAULT_REPL_CONFIG, llm: { ...DEFAULT_REPL_CONFIG.llm, apiKey: 'sk-x' } },
  });
  assert.equal(r.summary.fail, 0);
  // The healthy path has 5 ok checks (node, provider.set, provider.api_key, sandbox, deps.installed, deps.workspaces).
  assert.ok(r.summary.ok >= 5);
  for (const c of r.checks) {
    assert.notEqual(c.level, 'fail');
  }
});

test('runDiagnostics flags old Node majors as fail with a remediation', () => {
  const r = runDiagnostics({ ...BASE_INPUT, nodeVersion: '18.19.0' });
  const node = r.checks.find(c => c.id === 'node.version');
  assert.ok(node);
  assert.equal(node!.level, 'fail');
  assert.match(node!.fix ?? '', new RegExp(`Node ${REQUIRED_NODE_MAJOR}`));
});

test('runDiagnostics warns on missing api key for openai/anthropic but not for ollama', () => {
  const openaiNoKey = runDiagnostics({
    ...BASE_INPUT,
    config: { ...DEFAULT_REPL_CONFIG, llm: { ...DEFAULT_REPL_CONFIG.llm, provider: 'openai', apiKey: undefined } },
  });
  const k1 = openaiNoKey.checks.find(c => c.id === 'provider.api_key');
  assert.equal(k1?.level, 'warn');

  const ollama = runDiagnostics({
    ...BASE_INPUT,
    config: { ...DEFAULT_REPL_CONFIG, llm: { ...DEFAULT_REPL_CONFIG.llm, provider: 'ollama', apiKey: undefined } },
  });
  const k2 = ollama.checks.find(c => c.id === 'provider.api_key');
  // Ollama path skips the api-key check entirely.
  assert.equal(k2, undefined);
});

test('runDiagnostics fails when node_modules is missing or workspace pkgs unresolved', () => {
  const r = runDiagnostics({
    ...BASE_INPUT,
    nodeModulesExists: false,
    workspacePackages: [
      { name: '@openhand/core', resolved: false },
      { name: '@openhand/llm', resolved: true, version: '0.7.0' },
    ],
  });
  const installed = r.checks.find(c => c.id === 'deps.installed');
  const workspaces = r.checks.find(c => c.id === 'deps.workspaces');
  assert.equal(installed?.level, 'fail');
  assert.equal(workspaces?.level, 'fail');
  assert.match(workspaces?.detail ?? '', /@openhand\/core/);
  assert.equal(r.summary.fail >= 2, true);
});

test('runDiagnostics warns when sandbox paths list is empty', () => {
  const r = runDiagnostics({ ...BASE_INPUT, sandboxPaths: [] });
  const sb = r.checks.find(c => c.id === 'sandbox.paths');
  assert.equal(sb?.level, 'warn');
});

test('renderMarkdown emits a header, a table row per check, and fixes when applicable', () => {
  const r = runDiagnostics({ ...BASE_INPUT, nodeVersion: '18.0.0', nodeModulesExists: false });
  const md = renderMarkdown(r);
  assert.match(md, /^# OpenHand doctor/m);
  assert.match(md, /\| Check \| Level \| Detail \|/);
  assert.match(md, /## Suggested fixes/);
  // Count the table rows (one per check) by counting `| ... | OK/WARN/FAIL |` rows.
  const rows = md.split('\n').filter(l => /\| (OK|WARN|FAIL) \|/.test(l));
  assert.equal(rows.length, r.checks.length);
});

test('renderMarkdown skips the fixes section when everything is ok', () => {
  const md = renderMarkdown(runDiagnostics({
    ...BASE_INPUT,
    config: { ...DEFAULT_REPL_CONFIG, llm: { ...DEFAULT_REPL_CONFIG.llm, apiKey: 'k' } },
  }));
  assert.doesNotMatch(md, /## Suggested fixes/);
});

test('runDoctor writes the markdown report to outFile and exits 0 on healthy env', async () => {
  const tmp = path.join(os.tmpdir(), `openhand-doctor-${Date.now()}.md`);
  // Make a synthetic repoRoot with a node_modules dir so the deps.installed
  // check passes regardless of where the test runner CWDs.
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-doctor-root-'));
  fs.mkdirSync(path.join(fakeRoot, 'node_modules'));
  const captured: string[] = [];
  const deps: RunDoctorDeps = {
    loadConfig: async (): Promise<ReplConfig> => ({
      ...DEFAULT_REPL_CONFIG,
      llm: { ...DEFAULT_REPL_CONFIG.llm, apiKey: 'sk-x' },
    }),
    resolveWorkspacePackage: () => ({ resolved: true, version: '0.7.0' }),
    repoRoot: fakeRoot,
    sandboxPaths: ['/tmp'],
    pluginCount: 0,
  };
  const result = await runDoctor(
    { outFile: tmp },
    deps,
    { write: (s: string) => { captured.push(s); } },
  );
  assert.equal(result.code, 0);
  assert.equal(result.report.summary.fail, 0);
  assert.ok(fs.existsSync(tmp));
  const written = fs.readFileSync(tmp, 'utf-8');
  assert.match(written, /^# OpenHand doctor/m);
  assert.equal(captured.join(''), written);
  fs.unlinkSync(tmp);
  fs.rmSync(fakeRoot, { recursive: true, force: true });
});

test('runDoctor exits non-zero when any fail-level check fires', async () => {
  const captured: string[] = [];
  const deps: RunDoctorDeps = {
    loadConfig: async (): Promise<ReplConfig> => DEFAULT_REPL_CONFIG,
    // Mark workspace pkgs unresolved → forces deps.workspaces to fail.
    resolveWorkspacePackage: () => ({ resolved: false }),
    repoRoot: '/this/path/definitely/does/not/exist',
    sandboxPaths: ['/tmp'],
    pluginCount: 0,
  };
  const result = await runDoctor({}, deps, { write: (s: string) => { captured.push(s); } });
  assert.equal(result.code, 1);
  assert.ok(result.report.summary.fail >= 1);
});
