import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";

function expand(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export const GET: RequestHandler = ({ url }) => {
  const raw = url.searchParams.get("path");
  if (!raw) return json({ error: "path is required" }, { status: 400 });

  const resolved = path.resolve(expand(raw));
  const exists = fs.existsSync(resolved);
  if (!exists) {
    return json({
      exists: false,
      path: resolved,
    });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return json({
      exists: true,
      path: resolved,
      isDirectory: false,
    });
  }

  const hasPackageJson = fs.existsSync(path.join(resolved, "package.json"));
  const hasEvalTs = fs.existsSync(path.join(resolved, "eval.ts"));
  const hasEvalDir =
    fs.existsSync(path.join(resolved, "eval")) &&
    fs.existsSync(path.join(resolved, "eval", "eval.ts"));

  let packageName: string | undefined;
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(resolved, "package.json"), "utf-8"));
      if (typeof pkg.name === "string") packageName = pkg.name;
    } catch {
      // ignore
    }
  }

  return json({
    exists: true,
    path: resolved,
    isDirectory: true,
    hasPackageJson,
    hasEvalTs,
    hasEvalDir,
    packageName,
  });
};
