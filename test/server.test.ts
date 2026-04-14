import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvalServer } from "../src/server.js";

const tempDirs: string[] = [];
const servers: EvalServer[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-do-eval-server-"));
  tempDirs.push(dir);
  return dir;
}

function getPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

function sseCollect(url: string, count: number, timeoutMs = 3000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`SSE timeout: got ${events.length}/${count} events`));
    }, timeoutMs);

    const req = http.get(url, (res) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const block of lines) {
          const match = block.match(/^data: (.+)$/m);
          if (match) {
            events.push(JSON.parse(match[1]));
            if (events.length >= count) {
              clearTimeout(timer);
              req.destroy();
              resolve(events);
            }
          }
        }
      });
    });
    req.on("error", (err) => {
      if (events.length >= count) return;
      clearTimeout(timer);
      reject(err);
    });
  });
}

afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("EvalServer", () => {
  it("serves viewer.html at /", async () => {
    const dir = makeTempDir();
    const port = getPort();
    const server = new EvalServer(dir, port);
    servers.push(server);
    server.start();

    // Give server time to start
    await new Promise((r) => setTimeout(r, 100));

    const { status, body } = await httpGet(`http://localhost:${port}/`);
    expect(status).toBe(200);
    expect(body).toContain("Pi, do Eval");
  });

  it("serves run files from /runs/", async () => {
    const dir = makeTempDir();
    const runsPath = path.join(dir, "runs", "test-run");
    fs.mkdirSync(runsPath, { recursive: true });
    fs.writeFileSync(path.join(runsPath, "report.json"), JSON.stringify({ meta: { trial: "test" } }));

    const port = getPort();
    const server = new EvalServer(dir, port);
    servers.push(server);
    server.start();
    await new Promise((r) => setTimeout(r, 100));

    const { status, body } = await httpGet(`http://localhost:${port}/runs/test-run/report.json`);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ meta: { trial: "test" } });
  });

  it("returns 404 for missing files", async () => {
    const dir = makeTempDir();
    const port = getPort();
    const server = new EvalServer(dir, port);
    servers.push(server);
    server.start();
    await new Promise((r) => setTimeout(r, 100));

    const { status } = await httpGet(`http://localhost:${port}/runs/nope/report.json`);
    expect(status).toBe(404);
  });

  it("blocks path traversal", async () => {
    const dir = makeTempDir();
    const port = getPort();
    const server = new EvalServer(dir, port);
    servers.push(server);
    server.start();
    await new Promise((r) => setTimeout(r, 100));

    const { status } = await httpGet(`http://localhost:${port}/runs/../../../etc/passwd`);
    // Node's URL parser normalizes the path, so it resolves to /etc/passwd which is outside runs/
    // The server returns 403 if ".." is in the raw path, or 404 if the normalized path doesn't exist
    expect([403, 404]).toContain(status);
  });

  it("delivers SSE events and replays on connect", async () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "runs", "index.json"), JSON.stringify([]));

    const port = getPort();
    const server = new EvalServer(dir, port);
    servers.push(server);
    server.start();
    await new Promise((r) => setTimeout(r, 100));

    // Emit an event before connecting
    server.emit({
      type: "run_started",
      timestamp: Date.now(),
      dir: "test-run",
      trial: "example",
      variant: "default",
    });

    // Connect and collect: should get index_updated (from init) + run_started (replay)
    const events = await sseCollect(`http://localhost:${port}/events`, 2);
    expect(events).toHaveLength(2);
    expect((events[0] as { type: string }).type).toBe("index_updated");
    expect((events[1] as { type: string }).type).toBe("run_started");
  });
});
