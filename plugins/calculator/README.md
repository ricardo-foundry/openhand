# Calculator plugin

A tiny, dependency-free arithmetic evaluator for OpenHand. Exposes a single
tool (`calc_eval`) that agents can call to do math **without invoking `eval`
or `new Function()`**.

## Why a plugin?

Letting an LLM compute `2 ** 31 - 1` by generating JavaScript and passing it
to `eval` is a well-known anti-pattern. This plugin ships a proper parser so
the agent can call `calc_eval({ expression: "2 ** 31 - 1" })` and get back a
number — no sandbox escape surface.

## Supported syntax

| Feature | Example |
|---|---|
| Operators | `+ - * / % **` |
| Unary | `-x`, `+x` |
| Parens | `(1 + 2) * 3` |
| Literals | `42`, `3.14`, `1e-5` |
| Constants | `pi`, `e` |
| Functions | `abs sqrt min max floor ceil round log log10 log2 exp sin cos tan pow` |

Anything else — identifiers, property access, strings, assignment,
function definition, globals — is a parse error.

## Example tool call

```json
{
  "tool": "calc_eval",
  "arguments": { "expression": "sqrt(16) + 2 * pi" }
}
```

## Installing

Plugins under `plugins/` are discovered automatically by `PluginLoader`. The
manifest lives in `package.json` under the `openhand` key:

```json
{
  "openhand": {
    "id": "calculator",
    "version": "1.0.0",
    "entry": "./index.js"
  }
}
```

## Tests

```
cd plugins/calculator
npm test
```
