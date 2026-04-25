// Bridge an MCPClient's tools into the OpenHand Tool surface.
//
// MCP tool shape (from `tools/list`):
//   { name, description, inputSchema: { type:'object', properties, required } }
//
// OpenHand Tool shape (from @openhand/core):
//   { name, description, parameters: ToolParameter[], execute, permissions, sandboxRequired }
//
// We do a best-effort schema -> ToolParameter[] conversion. If the server
// returns a schema we don't recognize, we degrade to a single `{name:'arguments',
// type:'object'}` parameter so the agent can still pass through arbitrary
// JSON. We never silently drop tools.

import type { Tool, ToolParameter } from '@openhand/core';
import { MCPClient, MCPToolDescriptor, MCPToolCallResult } from './client';
import { JsonRpcRemoteError } from './jsonrpc';

export interface BridgeOptions {
  /**
   * Prefix prepended to every imported tool name. Defaults to `'mcp_'`.
   * Use this to disambiguate when bridging multiple MCP servers into the
   * same agent.
   */
  prefix?: string;
  /**
   * Permissions to attach to every bridged tool. The MCP server already
   * decides what its tools can do; OpenHand's policy layer treats these
   * as advisory. Default: `['mcp:invoke']`.
   */
  permissions?: string[];
  /** Whether bridged tools require sandbox (default false — MCP isolates). */
  sandboxRequired?: boolean;
}

const SCHEMA_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const;
type SchemaType = (typeof SCHEMA_TYPES)[number];

function coerceType(t: unknown): SchemaType {
  if (typeof t === 'string' && (SCHEMA_TYPES as readonly string[]).includes(t)) return t as SchemaType;
  if (t === 'integer') return 'number';
  return 'object';
}

/** Convert an MCP JSON Schema input to OpenHand ToolParameter[]. */
export function schemaToParameters(schema: MCPToolDescriptor['inputSchema']): ToolParameter[] {
  if (!schema || typeof schema !== 'object' || schema.type !== 'object' || !schema.properties) {
    // Fall back to a single freeform-object parameter.
    return [
      {
        name: 'arguments',
        type: 'object',
        description: 'Raw arguments forwarded to the MCP tool.',
        required: false,
      },
    ];
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const out: ToolParameter[] = [];
  for (const [name, propRaw] of Object.entries(schema.properties)) {
    const prop = (propRaw ?? {}) as { type?: unknown; description?: unknown; default?: unknown };
    const param: ToolParameter = {
      name,
      type: coerceType(prop.type),
      description: typeof prop.description === 'string' ? prop.description : '',
      required: required.has(name),
    };
    if (prop.default !== undefined) param.default = prop.default;
    out.push(param);
  }
  return out;
}

/** Flatten an MCP tool result into a string (for plain agent consumption). */
export function flattenResult(result: MCPToolCallResult): string {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content
    .map((c) => {
      if (typeof c.text === 'string') return c.text;
      // Non-text content gets stringified — caller can ask the structured
      // result for richer types.
      return JSON.stringify(c);
    })
    .join('\n');
}

/**
 * Wrap a single MCP tool descriptor as an OpenHand Tool. The closure
 * captures `client` so cleanup is owned by whoever constructed the bridge,
 * not by the agent runtime.
 */
export function wrapMcpTool(
  client: MCPClient,
  desc: MCPToolDescriptor,
  opts: Required<Pick<BridgeOptions, 'prefix' | 'permissions' | 'sandboxRequired'>>,
): Tool {
  const localName = `${opts.prefix}${desc.name}`;
  return {
    name: localName,
    description: desc.description ?? `MCP tool '${desc.name}' (no description)`,
    parameters: schemaToParameters(desc.inputSchema),
    permissions: opts.permissions,
    sandboxRequired: opts.sandboxRequired,
    async execute(params: Record<string, unknown>) {
      try {
        const result = await client.callTool(desc.name, params ?? {});
        if (result.isError) {
          // Propagate as a thrown error so Agent.executeTask records it as
          // a task:error event rather than a successful result containing
          // an error blob.
          throw new Error(`MCP tool '${desc.name}' returned isError: ${flattenResult(result)}`);
        }
        return {
          content: result.content,
          text: flattenResult(result),
        };
      } catch (err) {
        if (err instanceof JsonRpcRemoteError) {
          throw new Error(`MCP[${err.code}] ${err.message}`);
        }
        throw err;
      }
    },
  };
}

/**
 * Pull the full tool list from `client` and wrap each one. Returns a Map
 * keyed by the *prefixed* tool name so it can be merged straight into
 * `createTools()` output.
 */
export async function bridgeMcpTools(
  client: MCPClient,
  options: BridgeOptions = {},
): Promise<Map<string, Tool>> {
  const opts = {
    prefix: options.prefix ?? 'mcp_',
    permissions: options.permissions ?? ['mcp:invoke'],
    sandboxRequired: options.sandboxRequired ?? false,
  };
  const descriptors = await client.listTools();
  const out = new Map<string, Tool>();
  for (const desc of descriptors) {
    const tool = wrapMcpTool(client, desc, opts);
    out.set(tool.name, tool);
  }
  return out;
}
