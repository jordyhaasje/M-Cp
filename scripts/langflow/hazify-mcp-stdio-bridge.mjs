#!/usr/bin/env node
import readline from "node:readline";

const endpoint = process.argv[2] || "http://127.0.0.1:8788/mcp";
const token = process.env.HAZIFY_MCP_CLIENT_TOKEN || process.env.HAZIFY_MCP_TOKEN;

if (!token) {
  console.error("HAZIFY_MCP_CLIENT_TOKEN is required.");
  process.exit(1);
}

const respond = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const makeError = (id, code, message, data) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: {
    code,
    message,
    ...(data ? { data } : {}),
  },
});

const forward = async (payload) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-api-key": token,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return makeError(payload.id, -32000, `Hazify MCP returned non-JSON HTTP ${response.status}.`, {
      status: response.status,
      body: text.slice(0, 2000),
    });
  }

  if (!response.ok && body?.jsonrpc !== "2.0") {
    return makeError(payload.id, -32000, `Hazify MCP HTTP ${response.status}.`, body);
  }

  return body;
};

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch (error) {
    respond(makeError(null, -32700, `Invalid JSON: ${error.message}`));
    return;
  }

  try {
    const result = await forward(payload);
    if (result && payload.id !== undefined) {
      respond(result);
    }
  } catch (error) {
    if (payload.id !== undefined) {
      respond(makeError(payload.id, -32000, error.message));
    }
  }
});
