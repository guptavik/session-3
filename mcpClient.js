// Minimal MCP client for the extension. Talks to the Express server
// in mcp-server/ over the simple HTTP protocol it exposes:
//   GET  /mcp/list_tools  -> { tools: [{ name, description, inputSchema }, ...] }
//   POST /mcp/call_tool   -> { content: [{ type: "text", text: "<json-string>" }] }
//
// fetchMcpTools() rewrites `inputSchema` to `input_schema` so the result
// can be merged directly into the Anthropic Messages API tools array.

const MCP_SERVER_URL = "http://localhost:3000";

async function checkMcpServer() {
  try {
    const r = await fetch(`${MCP_SERVER_URL}/mcp/list_tools`, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

// Returns { configured, authenticated, expires_at } or null if the server is unreachable.
async function fetchGoogleOAuthStatus() {
  try {
    const r = await fetch(`${MCP_SERVER_URL}/oauth/status`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function googleOAuthStartUrl() {
  return `${MCP_SERVER_URL}/oauth/start`;
}

async function fetchMcpTools() {
  const r = await fetch(`${MCP_SERVER_URL}/mcp/list_tools`);
  if (!r.ok) {
    throw new Error(`MCP list_tools failed: ${r.status} ${r.statusText}`);
  }
  const data = await r.json();
  const tools = Array.isArray(data?.tools) ? data.tools : [];
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    // Anthropic API uses input_schema; MCP servers commonly use inputSchema.
    input_schema: t.input_schema || t.inputSchema
  }));
}

async function callMcpTool(toolName, toolInput) {
  const r = await fetch(`${MCP_SERVER_URL}/mcp/call_tool`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: toolName, arguments: toolInput || {} })
  });

  let payload;
  try {
    payload = await r.json();
  } catch {
    throw new Error(`MCP call_tool returned non-JSON (HTTP ${r.status}).`);
  }

  if (!r.ok || payload?.isError) {
    const detail = payload?.content?.[0]?.text || `HTTP ${r.status}`;
    throw new Error(`MCP call_tool '${toolName}' failed: ${detail}`);
  }

  const text = payload?.content?.[0]?.text;
  if (text == null) {
    throw new Error(`MCP response for '${toolName}' missing content[0].text`);
  }
  try {
    return JSON.parse(text);
  } catch {
    // Some tools may return plain text — pass it through.
    return text;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { checkMcpServer, fetchMcpTools, callMcpTool, MCP_SERVER_URL };
}
