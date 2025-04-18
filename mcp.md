# MCP TypeScript SDK Documentation

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [What is MCP?](#what-is-mcp)
- [Core Concepts](#core-concepts)
- [Running Your Server](#running-your-server)
- [Examples](#examples)
- [Advanced Usage](#advanced-usage)

## Overview

The Model Context Protocol (MCP) enables applications to provide context for LLMs in a standardized way, decoupling context provision from LLM interaction. This TypeScript SDK implements the full MCP specification, making it easy to:

- Build MCP clients that connect to any MCP server
- Create MCP servers exposing resources, prompts, and tools
- Use standard transports like stdio and Streamable HTTP
- Handle all MCP protocol messages and lifecycle events[1]

## Installation

```bash
npm install @modelcontextprotocol/sdk
```

## Quickstart

Create a simple MCP server exposing a calculator tool and a greeting resource:

```typescript
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Create an MCP server
const server = new McpServer({ name: "Demo", version: "1.0.0" });

// Add an addition tool
server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
  content: [{ type: "text", text: String(a + b) }]
}));

// Add a dynamic greeting resource
server.resource(
  "greeting",
  new ResourceTemplate("greeting://{name}", { list: undefined }),
  async (uri, { name }) => ({
    contents: [{ uri: uri.href, text: `Hello, ${name}!` }]
  })
);

// Start receiving messages on stdin and sending on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
```


## What is MCP?

MCP is a protocol for building servers that expose data and functionality to LLM applications securely and in a standardized way. Think of it as a web API designed specifically for LLM interactions. MCP servers can:

- Expose data through **Resources** (like GET endpoints)
- Provide functionality through **Tools** (like POST endpoints)
- Define interaction patterns through **Prompts** (reusable templates for LLMs)[1]

## Core Concepts

**Server**

The `McpServer` is the main interface to the MCP protocol, handling connection management, protocol compliance, and message routing.

```typescript
const server = new McpServer({ name: "My App", version: "1.0.0" });
```

**Resources**

Resources expose data to LLMs, similar to GET endpoints.

```typescript
// Static resource
server.resource(
  "config",
  "config://app",
  async (uri) => ({
    contents: [{ uri: uri.href, text: "App configuration here" }]
  })
);

// Dynamic resource with parameters
server.resource(
  "user-profile",
  new ResourceTemplate("users://{userId}/profile", { list: undefined }),
  async (uri, { userId }) => ({
    contents: [{ uri: uri.href, text: `Profile data for user ${userId}` }]
  })
);
```

**Tools**

Tools allow LLMs to take actions via your server, performing computation or side effects.

```typescript
// Simple tool with parameters
server.tool(
  "calculate-bmi",
  { weightKg: z.number(), heightM: z.number() },
  async ({ weightKg, heightM }) => ({
    content: [{ type: "text", text: String(weightKg / (heightM * heightM)) }]
  })
);

// Async tool with external API call
server.tool(
  "fetch-weather",
  { city: z.string() },
  async ({ city }) => {
    const response = await fetch(`https://api.weather.com/${city}`);
    const data = await response.text();
    return { content: [{ type: "text", text: data }] };
  }
);
```

**Prompts**

Prompts are reusable templates for LLM interactions.

```typescript
server.prompt(
  "review-code",
  { code: z.string() },
  ({ code }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Please review this code:\n\n${code}` }
      }
    ]
  })
);
```


## Running Your Server

MCP servers require a transport for communication. Two main options:

### stdio Transport

Ideal for CLI tools and direct integrations.

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "example-server", version: "1.0.0" });
// ... set up server resources, tools, and prompts ...
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Streamable HTTP Transport

For remote servers, use Streamable HTTP transport for client requests and notifications.

#### With Session Management

Supports stateful servers with session management:

```typescript
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/inMemory.js";

const app = express();
app.use(express.json());
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

app.post('/mcp', async (req, res) => {
  // Session management logic as described above
});
app.get('/mcp', /* ... */);
app.delete('/mcp', /* ... */);
app.listen(3000);
```

#### Stateless (No Session Management)

For simple, stateless servers:

```typescript
const app = express();
app.use(express.json());
const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined
});
app.post('/mcp', async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});
app.listen(3000);
```


## Examples

**Echo Server**

Demonstrates resources, tools, and prompts:

```typescript
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "Echo", version: "1.0.0" });

server.resource(
  "echo",
  new ResourceTemplate("echo://{message}", { list: undefined }),
  async (uri, { message }) => ({
    contents: [{ uri: uri.href, text: `Resource echo: ${message}` }]
  })
);

server.tool(
  "echo",
  { message: z.string() },
  async ({ message }) => ({
    content: [{ type: "text", text: `Tool echo: ${message}` }]
  })
);

server.prompt(
  "echo",
  { message: z.string() },
  ({ message }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Please process this message: ${message}` }
      }
    ]
  })
);
```

**SQLite Explorer**

Integrates with a SQLite database:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import sqlite3 from "sqlite3";
import { promisify } from "util";
import { z } from "zod";

const server = new McpServer({ name: "SQLite Explorer", version: "1.0.0" });

const getDb = () => {
  const db = new sqlite3.Database("database.db");
  return {
    all: promisify(db.all.bind(db)),
    close: promisify(db.close.bind(db))
  };
};

server.resource(
  "schema",
  "schema://main",
  async (uri) => {
    const db = getDb();
    try {
      const tables = await db.all("SELECT sql FROM sqlite_master WHERE type='table'");
      return { contents: [{ uri: uri.href, text: tables.map((t: {sql: string}) => t.sql).join("\n") }] };
    } finally {
      await db.close();
    }
  }
);

server.tool(
  "query",
  { sql: z.string() },
  async ({ sql }) => {
    const db = getDb();
    try {
      const results = await db.all(sql);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (err: unknown) {
      const error = err as Error;
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    } finally {
      await db.close();
    }
  }
);
```


## Advanced Usage

### Dynamic Servers

Add, update, or remove tools/resources/prompts after the server is connected (emits `listChanged` notifications):

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "Dynamic Example", version: "1.0.0" });

const listMessageTool = server.tool(
  "listMessages",
  { channel: z.string() },
  async ({ channel }) => ({ content: [{ type: "text", text: await listMessages(channel) }] })
);

const putMessageTool = server.tool(
  "putMessage",
  { channel: z.string(), message: z.string() },
  async ({ channel, message }) => ({ content: [{ type: "text", text: await putMessage(channel, message) }] })
);

putMessageTool.disable();

const upgradeAuthTool = server.tool(
  "upgradeAuth",
  { permission: z.enum(["write", "admin"]) },
  async ({ permission }) => {
    // ... logic to upgrade permissions and update tools ...
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Low-Level Server

For more control, use the low-level `Server` class:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "example-server", version: "1.0.0" },
  { capabilities: { prompts: {} } }
);

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [{
      name: "example-prompt",
      description: "An example prompt template",
      arguments: [{ name: "arg1", description: "Example argument", required: true }]
    }]
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "example-prompt") {
    throw new Error("Unknown prompt");
  }
  return {
    description: "Example prompt",
    messages: [{ role: "user", content: { type: "text", text: "Example prompt text" } }]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Writing MCP Clients

The SDK provides a high-level client interface:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["server.js"] });
const client = new Client({ name: "example-client", version: "1.0.0" });
await client.connect(transport);

// List prompts
const prompts = await client.listPrompts();

// Get a prompt
const prompt = await client.getPrompt({ name: "example-prompt", arguments: { arg1: "value" } });

// List resources
const resources = await client.listResources();

// Read a resource
const resource = await client.readResource({ uri: "file:///example.txt" });

// Call a tool
const result = await client.callTool({ name: "example-tool", arguments: { arg1: "value" } });
```


### Proxy Authorization Requests Upstream

Proxy OAuth requests to an external provider:

```typescript
import express from 'express';
import { ProxyOAuthServerProvider, mcpAuthRouter } from '@modelcontextprotocol/sdk';

const app = express();
const proxyProvider = new ProxyOAuthServerProvider({
  endpoints: {
    authorizationUrl: "https://auth.external.com/oauth2/v1/authorize",
    tokenUrl: "https://auth.external.com/oauth2/v1/token",
    revocationUrl: "https://auth.external.com/oauth2/v1/revoke",
  },
  verifyAccessToken: async (token) => ({
    token, clientId: "123", scopes: ["openid", "email", "profile"],
  }),
  getClient: async (client_id) => ({
    client_id, redirect_uris: ["http://localhost:3000/callback"],
  })
});

app.use(mcpAuthRouter({
  provider: proxyProvider,
  issuerUrl: new URL("http://auth.external.com"),
  baseUrl: new URL("http://mcp.example.com"),
  serviceDocumentationUrl: new URL("https://docs.example.com/"),
}));
```

- Forward OAuth requests to an external provider
- Add custom token validation logic
- Manage client registrations
- Provide custom documentation URLs
- Maintain control over the OAuth flow while delegating to an external provider[1]

---

For more details and the latest updates, refer to the official MCP SDK documentation and examples on npmjs.com[1].
