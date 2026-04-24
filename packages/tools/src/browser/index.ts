import { Tool } from '@openhand/core';
import * as cheerio from 'cheerio';

/**
 * Validate an outbound URL against SSRF. Rejects:
 *   - non-http(s) schemes (file:, data:, gopher:, ftp:, ...)
 *   - localhost / loopback
 *   - link-local / cloud metadata services (169.254.0.0/16)
 *   - RFC1918 private ranges (10/8, 172.16/12, 192.168/16)
 *   - IPv6 equivalents (::1, fe80::/10, fc00::/7)
 */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Disallowed URL scheme: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();

  // Explicitly deny hostnames that frequently appear in SSRF payloads.
  const DENY_HOSTS = new Set([
    'localhost',
    '0.0.0.0',
    'metadata.google.internal',
    'metadata.goog',
  ]);
  if (DENY_HOSTS.has(host)) {
    throw new Error(`Blocked hostname: ${host}`);
  }

  // IPv4 literal?
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(n => Number(n));
    if (octets.some(n => n > 255)) {
      throw new Error(`Invalid IPv4 literal: ${host}`);
    }
    const [a, b] = octets as [number, number, number, number];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 255 // broadcast
    ) {
      throw new Error(`Blocked private/loopback IPv4: ${host}`);
    }
  }

  // IPv6 literal: URL.hostname wraps brackets, strip them.
  if (host.startsWith('[') && host.endsWith(']')) {
    const ipv6 = host.slice(1, -1);
    if (
      ipv6 === '::1' ||
      ipv6 === '::' ||
      ipv6.startsWith('fe80:') ||
      ipv6.startsWith('fc') ||
      ipv6.startsWith('fd')
    ) {
      throw new Error(`Blocked private/loopback IPv6: ${ipv6}`);
    }
  }

  return url;
}

/** Shared response-size ceiling for all browser tools (bytes). */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MiB
const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchBounded(
  url: URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ text: string; status: number; statusText: string; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });

    // Bound total bytes read.
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return {
        text: text.substring(0, MAX_RESPONSE_BYTES),
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
      };
    }
    let received = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(merged);
    return {
      text,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Simple browser tools using fetch (no headless Chromium).
 * All requests go through `assertSafeUrl` for SSRF protection.
 */
export function createBrowserTools(): Tool[] {
  return [
    {
      name: 'browser_fetch',
      description: 'Fetch a remote URL (SSRF-protected, 2 MiB cap, 15s timeout).',
      parameters: [
        { name: 'url', type: 'string', description: 'Target URL', required: true },
        {
          name: 'method',
          type: 'string',
          description: 'HTTP method',
          required: false,
          default: 'GET',
        },
        {
          name: 'headers',
          type: 'object',
          description: 'Request headers',
          required: false,
          default: {},
        },
        { name: 'body', type: 'string', description: 'Request body', required: false },
      ],
      permissions: ['network:http'],
      sandboxRequired: false,
      execute: async (params: Record<string, any>) => {
        const url = assertSafeUrl(String(params.url ?? ''));
        const method = String(params.method ?? 'GET').toUpperCase();
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
          throw new Error(`Unsupported method: ${method}`);
        }

        const headers: Record<string, string> = { ...(params.headers ?? {}) };
        // Strip hop-by-hop and auth headers we never want to forward from
        // attacker-controlled input into our own network.
        delete headers.Host;
        delete headers.host;
        delete headers.Cookie;
        delete headers.cookie;

        const { text, status, statusText, headers: resHeaders } = await fetchBounded(url, {
          method,
          headers,
          body: params.body,
        });

        return {
          url: url.toString(),
          status,
          statusText,
          headers: resHeaders,
          content: text,
        };
      },
    },
    {
      name: 'browser_extract',
      description: 'Fetch a page and extract readable text (optionally by selector).',
      parameters: [
        { name: 'url', type: 'string', description: 'Page URL', required: true },
        {
          name: 'selector',
          type: 'string',
          description: 'Optional CSS selector',
          required: false,
        },
      ],
      permissions: ['network:http'],
      sandboxRequired: false,
      execute: async (params: Record<string, any>) => {
        const url = assertSafeUrl(String(params.url ?? ''));
        const { text: html } = await fetchBounded(url);
        const $ = cheerio.load(html);

        if (params.selector) {
          const elements = $(String(params.selector))
            .map((_, el) => $(el).text())
            .get();
          return { elements, count: elements.length };
        }

        $('script, style, nav, footer, header, iframe, noscript').remove();
        const title = $('title').text();
        const text = $('body').text().replace(/\s+/g, ' ').trim();

        return {
          title,
          text: text.substring(0, 50_000),
          url: url.toString(),
        };
      },
    },
    {
      name: 'browser_search',
      description: 'Search the web via DuckDuckGo (HTML endpoint).',
      parameters: [
        { name: 'query', type: 'string', description: 'Search query', required: true },
        {
          name: 'limit',
          type: 'number',
          description: 'Max results',
          required: false,
          default: 5,
        },
      ],
      permissions: ['network:http'],
      sandboxRequired: false,
      execute: async (params: Record<string, any>) => {
        const query = String(params.query ?? '').trim();
        if (!query) throw new Error('query is required');
        const limit = Math.min(Math.max(Number(params.limit ?? 5) | 0, 1), 20);

        const searchUrl = assertSafeUrl(
          `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        );
        const { text: html } = await fetchBounded(searchUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 OpenHand',
          },
        });
        const $ = cheerio.load(html);

        const results: Array<{ title: string; snippet: string; url: string }> = [];
        $('.result').each((i, el) => {
          if (i >= limit) return;
          const title = $(el).find('.result__title').text().trim();
          const snippet = $(el).find('.result__snippet').text().trim();
          const urlText = $(el).find('.result__url').text().trim();
          if (title && urlText) {
            results.push({ title, snippet, url: urlText });
          }
        });

        return { query, results, count: results.length };
      },
    },
  ];
}
