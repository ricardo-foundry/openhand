'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../index.js');

test('evaluate() handles basic arithmetic', () => {
  assert.equal(plugin.evaluate('1 + 2'), 3);
  assert.equal(plugin.evaluate('10 - 4'), 6);
  assert.equal(plugin.evaluate('3 * 4'), 12);
  assert.equal(plugin.evaluate('20 / 4'), 5);
});

test('evaluate() respects operator precedence', () => {
  assert.equal(plugin.evaluate('2 + 3 * 4'), 14);
  assert.equal(plugin.evaluate('(2 + 3) * 4'), 20);
  assert.equal(plugin.evaluate('2 ** 3 ** 2'), 512); // right-assoc: 2^(3^2)
});

test('evaluate() supports unary minus and plus', () => {
  assert.equal(plugin.evaluate('-5 + 3'), -2);
  assert.equal(plugin.evaluate('+5'), 5);
  assert.equal(plugin.evaluate('-(2 * 3)'), -6);
});

test('evaluate() supports whitelisted functions and constants', () => {
  assert.equal(plugin.evaluate('sqrt(16)'), 4);
  assert.equal(plugin.evaluate('abs(-7)'), 7);
  assert.equal(plugin.evaluate('min(3, 1, 5)'), 1);
  assert.equal(plugin.evaluate('max(3, 1, 5)'), 5);
  assert.ok(Math.abs(plugin.evaluate('pi') - Math.PI) < 1e-12);
  assert.ok(Math.abs(plugin.evaluate('e') - Math.E) < 1e-12);
});

test('evaluate() rejects non-math identifiers', () => {
  assert.throws(() => plugin.evaluate('foo + 1'), /unknown identifier/);
  assert.throws(() => plugin.evaluate('process'), /unknown identifier/);
  assert.throws(() => plugin.evaluate('globalThis'), /unknown identifier/);
});

test('evaluate() rejects unknown function calls', () => {
  assert.throws(() => plugin.evaluate('alert(1)'), /unknown function/);
  assert.throws(() => plugin.evaluate('eval(1)'), /unknown function/);
});

test('evaluate() rejects dangerous syntax (no strings, no assignment, no property access)', () => {
  assert.throws(() => plugin.evaluate('"hi"'));
  assert.throws(() => plugin.evaluate('x = 1'));
  assert.throws(() => plugin.evaluate('a.b'));
  assert.throws(() => plugin.evaluate('[1,2,3]'));
});

test('evaluate() rejects division by zero and modulo by zero', () => {
  assert.throws(() => plugin.evaluate('1 / 0'), /division by zero/);
  assert.throws(() => plugin.evaluate('1 % 0'), /modulo by zero/);
});

test('evaluate() rejects empty and overly long inputs', () => {
  assert.throws(() => plugin.evaluate(''), /empty/);
  const huge = '1+'.repeat(300) + '1';
  assert.throws(() => plugin.evaluate(huge), /too long/);
});

test('calc_eval tool returns { expression, value }', async () => {
  const tool = plugin.tools.find(t => t.name === 'calc_eval');
  assert.ok(tool);
  const result = await tool.execute({ expression: '2 + 3' }, {});
  assert.equal(result.value, 5);
  assert.equal(result.expression, '2 + 3');
});
