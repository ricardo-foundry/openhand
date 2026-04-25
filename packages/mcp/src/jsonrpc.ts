// Minimal JSON-RPC 2.0 framing for MCP-over-stdio.
//
// MCP servers historically used Content-Length-framed messages, but the
// canonical stdio variant in the public spec is *line-delimited JSON* (LDJSON)
// — one JSON object per line, terminated by `\n`. We implement the LDJSON
// variant only; if a future MCP profile needs LSP-style framing it is a
// separate transport. This file therefore has no external dependencies and
// stays under 100 lines.

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcError;

// Standard JSON-RPC 2.0 error codes (subset we actually emit).
export const ERROR_CODES = Object.freeze({
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // -32000..-32099 reserved for server-defined; we use:
  TransportClosed: -32001,
  Timeout: -32002,
});

export class JsonRpcRemoteError extends Error {
  public readonly code: number;
  public readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'JsonRpcRemoteError';
    this.code = code;
    this.data = data;
  }
}

/**
 * Encode a single JSON-RPC message as a single line of LDJSON.
 * Strips embedded newlines defensively — the framing is line-delimited so
 * we MUST guarantee no `\n` slips through inside a payload.
 */
export function encode(msg: JsonRpcMessage): string {
  const json = JSON.stringify(msg);
  if (json.includes('\n')) {
    // JSON.stringify never emits raw \n outside strings; if a string field
    // contains a literal newline JSON.stringify already escapes it. So this
    // branch should be unreachable, but we assert to fail loud if a future
    // contributor swaps in a non-conforming serializer.
    throw new Error('jsonrpc encode: payload contains raw newline');
  }
  return json + '\n';
}

/**
 * Stateful LDJSON decoder. `push(chunk)` returns zero or more parsed
 * messages and buffers the trailing partial line. Bad lines surface as
 * synthetic JsonRpcError entries with `id: null` so the caller can decide
 * whether to log or fail closed — they are NEVER thrown synchronously,
 * because a malformed line from a buggy server should not crash our event
 * loop.
 */
export class LineDecoder {
  private buf = '';

  push(chunk: string): JsonRpcMessage[] {
    this.buf += chunk;
    const out: JsonRpcMessage[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as JsonRpcMessage;
        if (typeof parsed !== 'object' || parsed === null || (parsed as { jsonrpc?: unknown }).jsonrpc !== '2.0') {
          out.push({
            jsonrpc: '2.0',
            id: null,
            error: { code: ERROR_CODES.InvalidRequest, message: 'not a JSON-RPC 2.0 message', data: line.slice(0, 200) },
          });
          continue;
        }
        out.push(parsed);
      } catch (err) {
        out.push({
          jsonrpc: '2.0',
          id: null,
          error: { code: ERROR_CODES.ParseError, message: (err as Error).message, data: line.slice(0, 200) },
        });
      }
    }
    return out;
  }

  /** Bytes still buffered (incomplete trailing line). Useful in tests. */
  pending(): string {
    return this.buf;
  }
}
