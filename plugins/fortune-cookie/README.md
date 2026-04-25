# Fortune Cookie plugin

A deliberately silly companion plugin: returns a one-line aphorism in your
chosen mood. **No LLM call, no network, no file I/O** — just a 200-line
static library baked into `index.js`.

It's also a useful smoke-test plugin: when the loader picks it up, calling
`fortune_get` is the cheapest possible "did the whole pipeline wire up?"
check.

## Tool: `fortune_get`

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `mood` | `'uplifting' \| 'skeptical' \| 'philosophical'` | no | `'uplifting'` | Which corner of the library to draw from. |
| `seed` | integer | no | — | Optional seed for deterministic picks (handy in tests). |

Returns:

```json
{
  "mood": "philosophical",
  "fortune": "The cave you fear to enter holds the treasure you seek.",
  "index": 20,
  "total": 68
}
```

## Examples

```js
const fortune = require('@openhand/plugin-fortune-cookie');

// Random uplifting line:
fortune.pick('uplifting');

// Deterministic skeptical line (same seed always picks the same fortune):
fortune.pick('skeptical', 42);

// Through the tool interface, exactly as the agent calls it:
await fortune.tools[0].execute({ mood: 'philosophical' }, {});
```

## Mood guide

- **uplifting** — encouragement, persistence, "you got this" energy.
- **skeptical** — engineering Murphy-isms, on-call wisdom, healthy paranoia.
- **philosophical** — public-domain proverbs, Stoic / Zen flavoured aphorisms.

## Tests

```bash
cd plugins/fortune-cookie
npm test
```

Six tests, ~50 ms total. Zero dependencies, zero permissions.
