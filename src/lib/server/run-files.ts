import * as fs from "node:fs";
import * as path from "node:path";

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

export function createRunsFileResponse(runsDir: string, relativePath: string): Response {
  const runsRoot = path.resolve(runsDir, "runs");
  const filePath = path.resolve(runsRoot, relativePath);

  if (!isWithinRoot(runsRoot, filePath)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const realRunsRoot = fs.realpathSync(runsRoot);
    const realPath = fs.realpathSync(filePath);
    if (!isWithinRoot(realRunsRoot, realPath)) {
      return new Response("Forbidden", { status: 403 });
    }
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(filePath);
  const mime = MIME[ext] ?? "application/octet-stream";
  const content = fs.readFileSync(filePath);
  return new Response(content, {
    headers: { "Content-Type": mime },
  });
}

function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}
