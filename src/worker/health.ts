import { createServer, type Server } from "node:http";

import type { WorkerHealth } from "./runtime";

/**
 * Probes of the worker process (F3d), the counterpart of the web's
 * /api/health/live and /api/health/ready: `GET /health/live` answers while
 * the process runs; `GET /health/ready` only when the worker started and the
 * database answered recently. Bodies carry the status only.
 */
export function startHealthServer(
  port: number,
  health: () => WorkerHealth,
  host = "0.0.0.0",
): Promise<Server> {
  const server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];
    const send = (status: number, body: Record<string, string>) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "GET")
      return send(405, { status: "method_not_allowed" });
    if (path === "/health/live") return send(200, { status: "ok" });
    if (path === "/health/ready") {
      return health().ready
        ? send(200, { status: "ok" })
        : send(503, { status: "unavailable" });
    }
    return send(404, { status: "not_found" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
