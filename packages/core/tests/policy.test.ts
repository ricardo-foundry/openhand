import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine } from '../src/policy';

test('default-deny engine refuses calls with no matching rule', async () => {
  const engine = new PolicyEngine({ defaultEffect: 'deny' });
  const allowed = await engine.check(['file:read'], {});
  assert.equal(allowed, false);
});

test('default-allow engine (for local dev) permits calls with no matching rule', async () => {
  const engine = new PolicyEngine({ defaultEffect: 'allow' });
  const allowed = await engine.check(['file:read'], {});
  assert.equal(allowed, true);
});

test('explicit deny rule beats a broad allow rule', async () => {
  const engine = new PolicyEngine({ defaultEffect: 'allow' });
  engine.addPolicy({
    id: 'allow-all',
    name: 'allow all',
    description: '',
    rules: [{ resource: '*', action: '*', effect: 'allow' }],
    enabled: true,
  });
  engine.addPolicy({
    id: 'deny-shell',
    name: 'deny shell',
    description: '',
    rules: [{ resource: 'shell:*', action: '*', effect: 'deny' }],
    enabled: true,
  });
  const shellAllowed = await engine.check(['shell:exec'], {});
  const fileAllowed = await engine.check(['file:read'], {});
  assert.equal(shellAllowed, false);
  assert.equal(fileAllowed, true);
});

test('wildcard suffix in resource matches permission prefixes', async () => {
  const engine = new PolicyEngine({ defaultEffect: 'deny' });
  engine.addPolicy({
    id: 'allow-file',
    name: 'allow file',
    description: '',
    rules: [{ resource: 'file:*', action: '*', effect: 'allow' }],
    enabled: true,
  });
  assert.equal(await engine.check(['file:read'], {}), true);
  assert.equal(await engine.check(['file:write'], {}), true);
  assert.equal(await engine.check(['shell:exec'], {}), false);
});

test('disabled policies do not participate', async () => {
  const engine = new PolicyEngine({ defaultEffect: 'deny' });
  engine.addPolicy({
    id: 'allow',
    name: 'allow',
    description: '',
    rules: [{ resource: '*', action: '*', effect: 'allow' }],
    enabled: false,
  });
  assert.equal(await engine.check(['file:read'], {}), false);
});
