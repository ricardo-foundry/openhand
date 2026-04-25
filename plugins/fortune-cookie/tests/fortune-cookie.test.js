'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../index.js');

test('library has at least 200 entries across the three moods', () => {
  assert.ok(plugin.size >= 200, `expected >= 200 fortunes, got ${plugin.size}`);
  assert.deepEqual(
    plugin.moods.slice().sort(),
    ['philosophical', 'skeptical', 'uplifting'],
  );
});

test('pick() returns a non-empty string for every supported mood', () => {
  for (const mood of plugin.moods) {
    const out = plugin.pick(mood);
    assert.equal(out.mood, mood);
    assert.equal(typeof out.fortune, 'string');
    assert.ok(out.fortune.length > 0, `empty fortune for mood ${mood}`);
    assert.ok(Number.isInteger(out.index));
    assert.ok(out.index >= 0 && out.index < out.total);
  }
});

test('pick() with a numeric seed is deterministic', () => {
  const a = plugin.pick('skeptical', 12345);
  const b = plugin.pick('skeptical', 12345);
  assert.deepEqual(a, b);
  // And different seeds usually pick different lines (try a few).
  const seen = new Set();
  for (let s = 0; s < 8; s++) seen.add(plugin.pick('uplifting', s).fortune);
  assert.ok(seen.size > 1, 'seeded picks all returned the same fortune');
});

test('pick() rejects invalid moods and non-integer seeds', () => {
  assert.throws(() => plugin.pick('grumpy'), /invalid mood/);
  assert.throws(() => plugin.pick('uplifting', 1.5), /seed must be an integer/);
  assert.throws(() => plugin.pick('uplifting', 'abc'), /seed must be an integer/);
});

test('fortune_get tool returns the same shape as pick()', async () => {
  const tool = plugin.tools.find(t => t.name === 'fortune_get');
  assert.ok(tool, 'fortune_get tool not registered');
  const out = await tool.execute({ mood: 'philosophical', seed: 7 }, {});
  assert.equal(out.mood, 'philosophical');
  assert.equal(typeof out.fortune, 'string');
  assert.ok(out.fortune.length > 0);
  assert.ok(Number.isInteger(out.index));
  assert.equal(out.total, plugin.pick('philosophical').total);
});

test('fortune_get defaults mood to "uplifting" and works with no params', async () => {
  const tool = plugin.tools.find(t => t.name === 'fortune_get');
  const out = await tool.execute({}, {});
  assert.equal(out.mood, 'uplifting');
  assert.equal(typeof out.fortune, 'string');
  assert.ok(out.fortune.length > 0);
  // Permissions stay empty — this plugin is pure CPU + memory.
  assert.deepEqual(tool.permissions, []);
  assert.equal(tool.sandboxRequired, false);
});
