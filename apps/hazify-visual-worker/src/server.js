import http from "node:http";
import { analyzeReferencePayload } from "./referenceAnalysis.js";

const host = process.env.HAZIFY_VISUAL_WORKER_HOST || "0.0.0.0";
const port = Number(process.env.PORT || process.env.HAZIFY_VISUAL_WORKER_PORT || 8081);

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true, service: "hazify-visual-worker" });
  }

  if (req.method === "POST" && req.url === "/v1/reference/analyze") {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString();
    }

    try {
      const payload = raw ? JSON.parse(raw) : {};
      const result = await analyzeReferencePayload(payload);
      return sendJson(res, 200, result);
    } catch (error) {
      return sendJson(res, 400, {
        success: false,
        error: error.message,
      });
    }
  }

  return sendJson(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`Hazify Visual Worker listening on ${host}:${port}`);
});
