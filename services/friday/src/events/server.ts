import { createServer, type Server, type ServerResponse } from "node:http";
import type { FridayEvent } from "@friday/shared";
import { eventBus } from "./bus.js";
import { log } from "../log.js";

let server: Server | null = null;
const clients = new Set<ServerResponse>();

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Last-Event-ID",
};

const KEEPALIVE_MS = 30_000;

export function startEventServer(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      // CORS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname === "/health") {
        res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === "/events") {
        res.writeHead(200, {
          ...CORS_HEADERS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        // Tell browser to reconnect quickly if connection drops
        res.write("retry:2000\n\n");

        // Replay missed events if Last-Event-ID is provided
        const lastId = req.headers["last-event-id"];
        if (lastId) {
          const lastSeq = parseInt(lastId as string, 10);
          if (!isNaN(lastSeq)) {
            for (const event of eventBus.replaySince(lastSeq)) {
              writeSSE(res, event);
            }
          }
        }

        // Subscribe to new events
        const onEvent = (event: FridayEvent) => writeSSE(res, event);
        eventBus.on("event", onEvent);
        clients.add(res);

        // Keepalive comments
        const keepalive = setInterval(() => {
          res.write(":keepalive\n\n");
        }, KEEPALIVE_MS);

        req.on("close", () => {
          eventBus.off("event", onEvent);
          clients.delete(res);
          clearInterval(keepalive);
        });

        return;
      }

      // 404 for anything else
      res.writeHead(404, CORS_HEADERS);
      res.end("Not found");
    });

    server.on("error", (err) => {
      log("error", "event_server_error", { error: err.message });
      reject(err);
    });

    server.listen(port, () => {
      log("info", "event_server_started", { port });
      resolve();
    });
  });
}

export function stopEventServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    // Close all SSE connections
    for (const client of clients) {
      client.end();
    }
    clients.clear();

    server.close(() => {
      server = null;
      resolve();
    });

    // Force-close after 2s
    setTimeout(() => {
      server?.closeAllConnections?.();
      server = null;
      resolve();
    }, 2000).unref();
  });
}

function writeSSE(res: ServerResponse, event: FridayEvent): void {
  res.write(`id:${event.seq}\nevent:${event.type}\ndata:${JSON.stringify(event)}\n\n`);
}
