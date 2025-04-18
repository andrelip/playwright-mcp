/**
 * Network request logging tools for MCP server.
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type * as playwright from 'playwright';
import type { Context } from '../context';
import type { Tool } from './tool';
import type { TextContent } from '@modelcontextprotocol/sdk/types';

// Define the shape for logged network requests
type LoggedRequest = {
  id: number;
  request: playwright.Request;
  response: playwright.Response | null;
  failureText?: string;
  status: 'pending' | 'finished' | 'failed';
  url: string;
  method: string;
  domain: string;
  type: string;
  initiator: string;
  requestHeaders: Record<string, string>;
  requestPostData?: string;
};

// Schemas
const startLoggingSchema = z.object({});
const listRequestsSchema = z.object({
  domain: z.string().optional().describe('Filter by domain'),
  type: z.string().optional().describe('Filter by resource type'),
  status: z.enum(['pending', 'finished', 'failed']).optional().describe('Filter by status'),
});
const readRequestSchema = z.object({ id: z.number().describe('Identifier of the logged request') });
const clearRequestsSchema = z.object({});
const searchRequestsSchema = z.object({
  pattern: z.string().describe('String to search for'),
  type: z.string().optional().describe('Filter by resource type'),
  lines: z.number().optional().describe('Number of context lines around each match'),
});

// Start logging tool
const startLoggingTool: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_network_start_logging',
    description: 'Start network request logging',
    inputSchema: zodToJsonSchema(startLoggingSchema),
  },
  handle: async (context: Context) => {
    context._loggingEnabled = true;
    context._requestLog = [];
    context._nextRequestId = 1;
    return {
      code: [],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: { content: [{ type: 'text', text: 'Network request logging started' }] },
    };
  },
};

// List requests tool
const listRequestsTool: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_network_list_requests',
    description: 'List logged network requests',
    inputSchema: zodToJsonSchema(listRequestsSchema),
  },
  handle: async (context: Context, params) => {
    const { domain, type, status } = listRequestsSchema.parse(params);
    const entries = context._requestLog.filter(e =>
      (!domain || e.domain === domain) &&
      (!type || e.type === type) &&
      (!status || e.status === status)
    );
    const summaries = entries.map(e => ({
      id: e.id,
      url: e.url,
      method: e.method,
      status: e.status,
      domain: e.domain,
      type: e.type,
      initiator: e.initiator,
    }));
    return {
      code: [],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: { content: [{ type: 'text', text: JSON.stringify(summaries) }] },
    };
  },
};

// Read request details tool
const readRequestTool: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_network_read_request',
    description: 'Read details of a logged network request',
    inputSchema: zodToJsonSchema(readRequestSchema),
  },
  handle: async (context: Context, params) => {
    const { id } = readRequestSchema.parse(params);
    const entry = context._requestLog.find(e => e.id === id);
    if (!entry)
      return {
        code: [],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: { content: [{ type: 'text', text: `Request with id ${id} not found` }] },
      };
    const details: Record<string, any> = {
      id: entry.id,
      url: entry.url,
      method: entry.method,
      status: entry.status,
      domain: entry.domain,
      type: entry.type,
      initiator: entry.initiator,
      requestHeaders: entry.requestHeaders,
      requestPostData: entry.requestPostData,
    };
    if (entry.status === 'finished' && entry.response) {
      const response = entry.response;
      details.responseStatus = response.status();
      details.responseHeaders = response.headers();
      try { details.responseBody = await response.text(); }
      catch { details.responseBody = '<binary>'; }
    } else if (entry.status === 'failed') {
      details.failureText = entry.failureText;
    }
    return {
      code: [],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] },
    };
  },
};

// Clear requests tool
const clearRequestsTool: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_network_clear_requests',
    description: 'Clear all logged network requests',
    inputSchema: zodToJsonSchema(clearRequestsSchema),
  },
  handle: async (context: Context) => {
    clearRequestsSchema.parse({});
    context._requestLog = [];
    context._nextRequestId = 1;
    return {
      code: [],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: { content: [{ type: 'text', text: 'Cleared network request log' }] },
    };
  },
};

// Search content tool
const searchRequestsTool: Tool = {
  capability: 'core',
  schema: {
    name: 'browser_network_search_requests',
    description: 'Search response bodies of logged network requests for a given string. Allows filtering by resource type and number of context lines. Returns up to 20 entries; if more matches exist, the output is truncated and a warning is included. Each entry contains the request id, file name, and snippet.',
    inputSchema: zodToJsonSchema(searchRequestsSchema),
  },
  handle: async (context: Context, params) => {
    const { pattern, type, lines } = searchRequestsSchema.parse(params);
    const results: { id: number; fileName: string; snippet: string }[] = [];
    for (const entry of context._requestLog) {
      if (entry.status !== 'finished' || !entry.response)
        continue;
      if (type && entry.type !== type)
        continue;
      let body: string;
      try { body = await entry.response.text(); } catch { continue; }
      const fileName = (() => {
        try {
          const parsed = new URL(entry.url);
          const segments = parsed.pathname.split('/');
          const name = segments.pop() || '';
          return name || entry.url;
        } catch {
          return entry.url;
        }
      })();
      const linesArray = body.split(/\r?\n/);
      const contextLines = lines ?? 0;
      for (let i = 0; i < linesArray.length; ++i) {
        if (linesArray[i].includes(pattern)) {
          const start = Math.max(0, i - contextLines);
          const end = Math.min(linesArray.length - 1, i + contextLines);
          const snippet = linesArray.slice(start, end + 1).join('\n');
          results.push({ id: entry.id, fileName, snippet });
        }
      }
    }
    // Limit output to a maximum number of entries and include warning if truncated
    const maxResults = 20;
    const totalMatches = results.length;
    const limitedResults = totalMatches > maxResults ? results.slice(0, maxResults) : results;
    const output: Record<string, any> = { results: limitedResults };
    if (totalMatches > maxResults)
      output.warning = `Results truncated to ${maxResults} entries (total matches: ${totalMatches})`;
    return {
      code: [],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] },
    };
  },
};
// Export all request tools
export default [startLoggingTool, listRequestsTool, readRequestTool, clearRequestsTool, searchRequestsTool];