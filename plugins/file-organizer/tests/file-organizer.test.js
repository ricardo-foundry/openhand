'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const plugin = require('../index.js');

function fakeEntry(name, isFile = true) {
  return { name, isFile: () => isFile, isDirectory: () => !isFile };
}

function fakeReaddir(entries) {
  return () => entries;
}

test('scan ignores dotfiles and directories, sorts by name', () => {
  const inv = plugin.scan('/tmp/demo', {
    readdir: fakeReaddir([
      fakeEntry('zebra.png'),
      fakeEntry('apple.md'),
      fakeEntry('.hidden'),
      fakeEntry('subdir', false),
    ]),
    resolve: p => p,
  });
  assert.equal(inv.root, '/tmp/demo');
  assert.equal(inv.items.length, 2);
  assert.equal(inv.items[0].name, 'apple.md');
  assert.equal(inv.items[0].category, 'docs');
  assert.equal(inv.items[1].name, 'zebra.png');
  assert.equal(inv.items[1].category, 'images');
});

test('scan opts.includeHidden surfaces dotfiles', () => {
  const inv = plugin.scan('/x', {
    readdir: fakeReaddir([fakeEntry('.env'), fakeEntry('readme.md')]),
    resolve: p => p,
    includeHidden: true,
  });
  assert.equal(inv.items.length, 2);
  assert.ok(inv.items.some(i => i.name === '.env'));
});

test('classify falls back to heuristic when no LLM is given', async () => {
  const inv = plugin.scan('/tmp', {
    readdir: fakeReaddir([fakeEntry('a.ts'), fakeEntry('b.mp3')]),
    resolve: p => p,
  });
  const out = await plugin.classify({ inventory: inv });
  assert.equal(out[0].category, 'code');
  assert.equal(out[0].confidence, 'heuristic');
  assert.equal(out[1].category, 'audio');
});

test('classify uses LLM-supplied labels and preserves index order', async () => {
  const inv = plugin.scan('/tmp', {
    readdir: fakeReaddir([
      fakeEntry('notes.unknownext'),
      fakeEntry('photo.unknownext'),
    ]),
    resolve: p => p,
  });
  const fakeLlm = {
    async complete() {
      return {
        content: '{"labels":[{"i":0,"category":"docs"},{"i":1,"category":"images"}]}',
      };
    },
  };
  const out = await plugin.classify({ inventory: inv, llm: fakeLlm });
  assert.equal(out[0].category, 'docs');
  assert.equal(out[0].confidence, 'llm');
  assert.equal(out[1].category, 'images');
});

test('classify recovers from garbage LLM responses', async () => {
  const inv = plugin.scan('/tmp', {
    readdir: fakeReaddir([fakeEntry('x.png'), fakeEntry('y.unknownext')]),
    resolve: p => p,
  });
  const fakeLlm = {
    async complete() {
      return { content: 'not json at all' };
    },
  };
  const out = await plugin.classify({ inventory: inv, llm: fakeLlm });
  assert.equal(out[0].category, 'images'); // kept from scan
  assert.equal(out[0].confidence, 'fallback');
  assert.equal(out[1].category, 'misc');
});

test('planRenames routes into category subfolders and avoids collisions', () => {
  const plan = plugin.planRenames({
    root: '/r',
    classified: [
      { name: 'a.md', ext: '.md', category: 'docs' },
      { name: 'a.md', ext: '.md', category: 'docs' }, // collision
    ],
  });
  assert.equal(plan[0].to, path.join('/r', 'docs', 'a.md'));
  assert.equal(plan[1].to, path.join('/r', 'docs', 'a-1.md'));
});

test('apply refuses to move outside root and never overwrites', async () => {
  const ops = [];
  const fakeFs = {
    mkdir: async p => ops.push(['mkdir', p]),
    rename: async (a, b) => ops.push(['rename', a, b]),
    exists: p => p === path.resolve('/r/docs/existing.md'),
  };
  const plan = [
    { from: '/r/a.md', to: '/r/docs/a.md', category: 'docs' },
    { from: '/r/b.md', to: '/r/docs/existing.md', category: 'docs' }, // will fail: exists
    { from: '/etc/passwd', to: '/r/docs/pw.md', category: 'docs' }, // escape src
    { from: '/r/c.md', to: '/elsewhere/c.md', category: 'docs' }, // escape dst
  ];
  const results = await plugin.apply(plan, { root: '/r', ...fakeFs });
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /already exists/);
  assert.equal(results[2].ok, false);
  assert.match(results[2].error, /outside root/);
  assert.equal(results[3].ok, false);
  assert.match(results[3].error, /outside root/);
  // only the first entry should have produced mkdir+rename
  const renameOps = ops.filter(o => o[0] === 'rename');
  assert.equal(renameOps.length, 1);
});

test('propose runs scan → heuristic classify → planRenames when useLlm=false', async () => {
  const origReaddir = require('fs').readdirSync;
  // monkey-patch readdirSync for scan's default path
  require('fs').readdirSync = () => [
    fakeEntry('song.mp3'),
    fakeEntry('photo.png'),
  ];
  try {
    const out = await plugin.propose({
      dir: '/tmp/fake',
      useLlm: false,
    });
    assert.equal(out.classified.length, 2);
    const cats = out.classified.map(c => c.category).sort();
    assert.deepEqual(cats, ['audio', 'images']);
    assert.equal(out.plan.length, 2);
    assert.ok(out.plan[0].to.includes(path.sep));
  } finally {
    require('fs').readdirSync = origReaddir;
  }
});

test('plugin manifest declares three tools with correct permissions', () => {
  const names = plugin.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['organize_apply', 'organize_propose', 'organize_scan']);
  const apply = plugin.tools.find(t => t.name === 'organize_apply');
  assert.deepEqual(apply.permissions, ['fs:write']);
  const scan = plugin.tools.find(t => t.name === 'organize_scan');
  assert.deepEqual(scan.permissions, ['fs:read']);
});
