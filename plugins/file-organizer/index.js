// OpenHand File Organizer Plugin
//
// Scans a directory, groups files into categories using a small LLM call
// (with a heuristic fallback so the plugin still works offline), and
// produces a rename / move proposal.
//
// **Dry-run is the default.** `apply=true` must be passed explicitly AND
// the host must be okay with the `fs:write` permission declared in the
// manifest. Even then, we only rename under the original scan root — we
// never escape it, never follow symlinks, never touch dotfiles unless
// asked.
//
// Exposed tools:
//   - organize_scan(dir)          — inventory (no LLM, no writes)
//   - organize_propose(dir, …)    — inventory + classify + rename plan
//   - organize_apply(plan)        — execute a previously approved plan

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_FILES = 2_000;
const DEFAULT_MODEL = 'gpt-4o-mini';

// Extension → category. Used both by the heuristic fallback AND as the
// allow-list when `useLlm` is false (keeps the plugin useful without a
// provider).
const EXT_MAP = Object.freeze({
  // docs
  '.md': 'docs',
  '.txt': 'docs',
  '.pdf': 'docs',
  '.doc': 'docs',
  '.docx': 'docs',
  '.rtf': 'docs',
  // images
  '.png': 'images',
  '.jpg': 'images',
  '.jpeg': 'images',
  '.gif': 'images',
  '.webp': 'images',
  '.svg': 'images',
  '.heic': 'images',
  // video
  '.mp4': 'video',
  '.mov': 'video',
  '.mkv': 'video',
  '.webm': 'video',
  '.avi': 'video',
  // audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.m4a': 'audio',
  '.ogg': 'audio',
  // archives
  '.zip': 'archives',
  '.tar': 'archives',
  '.gz': 'archives',
  '.7z': 'archives',
  '.rar': 'archives',
  // code
  '.js': 'code',
  '.ts': 'code',
  '.tsx': 'code',
  '.py': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.java': 'code',
  '.c': 'code',
  '.cpp': 'code',
  '.h': 'code',
  '.rb': 'code',
  // data
  '.json': 'data',
  '.csv': 'data',
  '.tsv': 'data',
  '.yaml': 'data',
  '.yml': 'data',
  '.xml': 'data',
  '.sqlite': 'data',
});

/**
 * Shallow directory scan. No LLM, no writes.
 * Returns an inventory sorted by filename for deterministic output.
 */
function scan(dir, opts) {
  if (!dir || typeof dir !== 'string') {
    throw new TypeError('dir must be a string');
  }
  const readdir = opts?.readdir || ((p) =>
    fs.readdirSync(p, { withFileTypes: true }));
  const resolveFn = opts?.resolve || path.resolve;
  const includeHidden = !!opts?.includeHidden;

  const root = resolveFn(dir);
  const entries = readdir(root);
  const items = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!includeHidden && e.name.startsWith('.')) continue;
    const ext = path.extname(e.name).toLowerCase();
    items.push({
      name: e.name,
      ext,
      category: EXT_MAP[ext] || 'misc',
    });
    if (items.length >= MAX_FILES) break;
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { root, items };
}

/**
 * Decide the target category for each file. If `llm` is provided, we ask it
 * once for the whole batch; otherwise we rely on the extension map (which
 * already produced `item.category` during scan).
 */
async function classify({ inventory, llm, model }) {
  if (!llm || typeof llm.complete !== 'function') {
    // Heuristic path — just echo back the scan's categories.
    return inventory.items.map(it => ({ ...it, confidence: 'heuristic' }));
  }
  const list = inventory.items
    .map((it, i) => `${i}: ${it.name}`)
    .join('\n');
  const res = await llm.complete({
    model: model || DEFAULT_MODEL,
    temperature: 0,
    maxTokens: 600,
    messages: [
      {
        role: 'system',
        content:
          'You label files for organising. Reply with JSON ONLY: an object ' +
          '{ "labels": [{"i": number, "category": string}] }. ' +
          'Use short lowercase categories from this set when they fit: ' +
          'docs, images, video, audio, archives, code, data, misc.',
      },
      { role: 'user', content: `Files:\n${list}` },
    ],
  });
  const labels = parseLabels(res && res.content, inventory.items.length);
  return inventory.items.map((it, i) => ({
    ...it,
    category: labels[i] || it.category,
    confidence: labels[i] ? 'llm' : 'fallback',
  }));
}

function parseLabels(raw, n) {
  const out = new Array(n).fill('');
  if (!raw || typeof raw !== 'string') return out;
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    const parsed = JSON.parse(s);
    const arr = Array.isArray(parsed?.labels) ? parsed.labels : [];
    for (const entry of arr) {
      const idx = Number(entry?.i);
      const cat = typeof entry?.category === 'string'
        ? entry.category.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24)
        : '';
      if (Number.isInteger(idx) && idx >= 0 && idx < n && cat) {
        out[idx] = cat;
      }
    }
  } catch {
    // fall through — we return whatever slots we filled, which may be none
  }
  return out;
}

/**
 * Build a rename plan: for each item, the proposed new path (always under
 * a per-category subfolder of the scan root). Pure; no IO.
 */
function planRenames({ root, classified }) {
  const used = new Set();
  const plan = [];
  for (const it of classified) {
    const dir = path.join(root, it.category);
    let candidate = path.join(dir, it.name);
    let n = 1;
    while (used.has(candidate)) {
      const parsed = path.parse(it.name);
      candidate = path.join(dir, `${parsed.name}-${n}${parsed.ext}`);
      n++;
    }
    used.add(candidate);
    plan.push({
      from: path.join(root, it.name),
      to: candidate,
      category: it.category,
      confidence: it.confidence || 'heuristic',
    });
  }
  return plan;
}

/**
 * Execute a plan. Refuses to move anything outside `root`, refuses to
 * overwrite existing files, and returns per-entry outcomes.
 *
 * `fs` functions are injectable so tests stay hermetic.
 */
async function apply(plan, opts) {
  if (!Array.isArray(plan)) throw new TypeError('plan must be an array');
  const root = opts?.root;
  if (!root) throw new Error('root is required');
  const resolvedRoot = path.resolve(root);

  const mkdir = opts?.mkdir || (async (p) => fs.promises.mkdir(p, { recursive: true }));
  const rename = opts?.rename || (async (a, b) => fs.promises.rename(a, b));
  const exists = opts?.exists || ((p) => fs.existsSync(p));

  const results = [];
  for (const entry of plan) {
    try {
      const from = path.resolve(entry.from);
      const to = path.resolve(entry.to);
      if (!from.startsWith(resolvedRoot + path.sep) && from !== resolvedRoot) {
        throw new Error(`refusing to move outside root: ${from}`);
      }
      if (!to.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`refusing to write outside root: ${to}`);
      }
      if (exists(to)) throw new Error(`target already exists: ${to}`);
      await mkdir(path.dirname(to));
      await rename(from, to);
      results.push({ from, to, ok: true });
    } catch (err) {
      results.push({
        from: entry.from,
        to: entry.to,
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }
  return results;
}

/** Top-level convenience: scan + classify + plan. */
async function propose({ dir, llm, model, useLlm = true, includeHidden = false }) {
  const inventory = scan(dir, { includeHidden });
  const classified = useLlm && llm
    ? await classify({ inventory, llm, model })
    : inventory.items.map(it => ({ ...it, confidence: 'heuristic' }));
  const plan = planRenames({ root: inventory.root, classified });
  return { root: inventory.root, classified, plan };
}

module.exports = {
  name: 'file-organizer',
  version: '1.0.0',
  description: 'Scan → classify → rename plan. Dry-run by default.',

  EXT_MAP,
  scan,
  classify,
  planRenames,
  propose,
  apply,

  tools: [
    {
      name: 'organize_scan',
      description: 'Shallow-scan a directory and return the file inventory.',
      parameters: [
        { name: 'dir', type: 'string', description: 'Absolute directory path', required: true },
      ],
      permissions: ['fs:read'],
      sandboxRequired: false,
      async execute(params) {
        return scan(params.dir);
      },
    },
    {
      name: 'organize_propose',
      description:
        'Scan a directory, classify files (optionally via LLM), and return a dry-run rename plan.',
      parameters: [
        { name: 'dir', type: 'string', description: 'Absolute directory path', required: true },
        { name: 'useLlm', type: 'boolean', description: 'Use LLM classifier', required: false },
      ],
      permissions: ['fs:read', 'llm:chat'],
      sandboxRequired: false,
      async execute(params, context) {
        const llm = context && context.llm;
        return await propose({
          dir: params.dir,
          llm,
          useLlm: params.useLlm !== false,
        });
      },
    },
    {
      name: 'organize_apply',
      description:
        'Execute a previously produced rename plan. Refuses anything outside the scan root.',
      parameters: [
        { name: 'plan', type: 'object', description: 'Rename plan array', required: true },
        { name: 'root', type: 'string', description: 'Original scan root', required: true },
      ],
      permissions: ['fs:write'],
      sandboxRequired: false,
      async execute(params) {
        return await apply(params.plan, { root: params.root });
      },
    },
  ],

  async onEnable() {
    // stateless
  },
};
