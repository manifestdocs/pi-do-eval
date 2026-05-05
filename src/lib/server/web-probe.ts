import http from "node:http";
import https from "node:https";

export interface WebProbeResult {
  ok: boolean;
  reason?: string;
}

export function probeDoEvalWeb(url: string, timeoutMs = 500): Promise<WebProbeResult> {
  return new Promise((resolve) => {
    const probeUrl = new URL("/api/projects", url);
    const client = probeUrl.protocol === "https:" ? https : http;
    const req = client.request(
      probeUrl,
      {
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode === 200 && body.includes('"projects"')) {
            resolve({ ok: true });
            return;
          }
          resolve({ ok: false, reason: `unexpected response from ${probeUrl.host}` });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, reason: `timed out connecting to ${probeUrl.host}` });
    });
    req.on("error", (error) => {
      resolve({ ok: false, reason: error.message });
    });
    req.end();
  });
}
