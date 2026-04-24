// OpenHand Calculator Plugin
//
// Evaluates arithmetic expressions WITHOUT `eval()` or `new Function()`.
// Supports: `+ - * / % **`, parentheses, unary +/-, numeric literals
// (integer, decimal, scientific notation), and a whitelist of functions
// (abs, sqrt, min, max, floor, ceil, round, log, log10, log2, exp, sin,
// cos, tan) plus constants (pi, e). Anything else fails closed.
//
// The parser is a tiny Pratt-style recursive descent that accepts only
// the tokens listed above — no identifiers outside the whitelist, no
// property access, no strings, no assignment. That's what makes this
// safe to expose as an agent tool.

'use strict';

const CONSTANTS = Object.freeze({ pi: Math.PI, e: Math.E });
const FUNCTIONS = Object.freeze({
  abs: Math.abs,
  sqrt: Math.sqrt,
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  pow: Math.pow,
});

function tokenize(input) {
  if (typeof input !== 'string') {
    throw new TypeError('expression must be a string');
  }
  if (input.length > 512) {
    throw new Error('expression too long (max 512 chars)');
  }
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < input.length && /[0-9.eE+\-]/.test(input[j])) {
        // Only consume +/- if it's part of an exponent (1e-5).
        if ((input[j] === '+' || input[j] === '-') && j > i) {
          const prev = input[j - 1];
          if (prev !== 'e' && prev !== 'E') break;
        }
        j++;
      }
      const lit = input.slice(i, j);
      const num = Number(lit);
      if (!Number.isFinite(num)) {
        throw new Error(`invalid numeric literal: ${lit}`);
      }
      tokens.push({ type: 'num', value: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++;
      const name = input.slice(i, j);
      tokens.push({ type: 'ident', value: name });
      i = j;
      continue;
    }
    if (c === '*' && input[i + 1] === '*') {
      tokens.push({ type: '**' });
      i += 2;
      continue;
    }
    if ('+-*/%(),'.includes(c)) {
      tokens.push({ type: c });
      i++;
      continue;
    }
    throw new Error(`unexpected character ${JSON.stringify(c)} at offset ${i}`);
  }
  return tokens;
}

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = expected => {
    const t = tokens[pos];
    if (!t || (expected && t.type !== expected)) {
      throw new Error(`expected ${expected}, got ${t ? t.type : 'EOF'}`);
    }
    pos++;
    return t;
  };

  // precedence: unary > ** > * / % > + -
  function parseExpr() {
    return parseAdditive();
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = consume().type;
      const right = parseMultiplicative();
      left = { type: 'bin', op, left, right };
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseExponent();
    while (peek() && (peek().type === '*' || peek().type === '/' || peek().type === '%')) {
      const op = consume().type;
      const right = parseExponent();
      left = { type: 'bin', op, left, right };
    }
    return left;
  }

  function parseExponent() {
    const left = parseUnary();
    if (peek() && peek().type === '**') {
      consume('**');
      const right = parseExponent(); // right-associative
      return { type: 'bin', op: '**', left, right };
    }
    return left;
  }

  function parseUnary() {
    if (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = consume().type;
      const operand = parseUnary();
      return { type: 'un', op, operand };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error('unexpected end of expression');
    if (t.type === 'num') {
      consume();
      return { type: 'num', value: t.value };
    }
    if (t.type === '(') {
      consume('(');
      const expr = parseExpr();
      consume(')');
      return expr;
    }
    if (t.type === 'ident') {
      consume();
      if (peek() && peek().type === '(') {
        consume('(');
        const args = [];
        if (peek() && peek().type !== ')') {
          args.push(parseExpr());
          while (peek() && peek().type === ',') {
            consume(',');
            args.push(parseExpr());
          }
        }
        consume(')');
        return { type: 'call', name: t.value, args };
      }
      return { type: 'ident', name: t.value };
    }
    throw new Error(`unexpected token ${t.type}`);
  }

  const ast = parseExpr();
  if (pos !== tokens.length) {
    throw new Error(`unexpected trailing token ${tokens[pos].type}`);
  }
  return ast;
}

function evalAst(node) {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'ident': {
      if (!Object.prototype.hasOwnProperty.call(CONSTANTS, node.name)) {
        throw new Error(`unknown identifier: ${node.name}`);
      }
      return CONSTANTS[node.name];
    }
    case 'call': {
      if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, node.name)) {
        throw new Error(`unknown function: ${node.name}`);
      }
      const args = node.args.map(evalAst);
      const out = FUNCTIONS[node.name](...args);
      if (!Number.isFinite(out)) throw new Error(`non-finite result from ${node.name}`);
      return out;
    }
    case 'un': {
      const v = evalAst(node.operand);
      return node.op === '-' ? -v : +v;
    }
    case 'bin': {
      const a = evalAst(node.left);
      const b = evalAst(node.right);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new Error('division by zero');
          return a / b;
        case '%':
          if (b === 0) throw new Error('modulo by zero');
          return a % b;
        case '**': return a ** b;
        default:
          throw new Error(`unknown operator: ${node.op}`);
      }
    }
    default:
      throw new Error(`unknown AST node: ${node.type}`);
  }
}

function evaluate(expression) {
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error('empty expression');
  const ast = parse(tokens);
  const result = evalAst(ast);
  if (!Number.isFinite(result)) throw new Error('non-finite result');
  return result;
}

module.exports = {
  name: 'calculator',
  version: '1.0.0',
  description: 'Evaluate arithmetic expressions safely (no eval, no Function).',

  // Exported so the tests can hit it directly without going through `tools`.
  evaluate,

  tools: [
    {
      name: 'calc_eval',
      description: 'Evaluate a math expression. Supports +-*/%**, parentheses, and a whitelist of Math.* functions.',
      parameters: [
        {
          name: 'expression',
          type: 'string',
          description: 'The arithmetic expression to evaluate, e.g. "2 + 3 * sqrt(16)"',
          required: true,
        },
      ],
      permissions: [],
      sandboxRequired: false,
      async execute(params) {
        const expr = params && typeof params.expression === 'string' ? params.expression : '';
        const value = evaluate(expr);
        return { expression: expr, value };
      },
    },
  ],

  async onEnable() {
    // best-effort; nothing to warm up
  },
};
