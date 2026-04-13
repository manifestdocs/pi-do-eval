import * as fs from "node:fs";
import * as path from "node:path";
import * as templates from "./templates.js";

interface ExtensionInfo {
  name: string;
  extensionPath: string;
}

function detectExtension(cwd: string): ExtensionInfo {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    console.error("No package.json found. Run this from the root of a Pi extension repo.");
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const name: string = pkg.name ?? "my-extension";

  const piExtensions: string[] | undefined = pkg.pi?.extensions;
  const extensionEntry = piExtensions?.[0];
  // Compute relative path from eval/ back to the extension entry
  const extensionPath = extensionEntry ? path.join("..", extensionEntry) : "../../src/index.ts";

  return { name, extensionPath };
}

function resolvePiDoEvalRef(): string {
  // Find where pi-do-eval actually lives and compute a file: reference from eval/
  try {
    const piDoEvalPkg = path.dirname(require.resolve("pi-do-eval/package.json", { paths: [process.cwd()] }));
    const evalDir = path.join(process.cwd(), "eval");
    const rel = path.relative(evalDir, piDoEvalPkg);
    return `file:${rel}`;
  } catch {
    // Not installed locally, assume npm
    return "^0.1.0";
  }
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

export async function runInit(cwd = process.cwd()) {
  const evalDir = path.join(cwd, "eval");

  if (fs.existsSync(evalDir) && fs.readdirSync(evalDir).length > 0) {
    console.error("eval/ directory already exists. Remove it first or run from a different directory.");
    process.exit(1);
  }

  const ext = detectExtension(cwd);
  const piDoEvalRef = resolvePiDoEvalRef();

  // Create directories
  fs.mkdirSync(path.join(evalDir, "plugins"), { recursive: true });
  fs.mkdirSync(path.join(evalDir, "trials", "example"), { recursive: true });

  // Write files
  writeFile(path.join(evalDir, "package.json"), templates.packageJson(ext.name, piDoEvalRef));
  writeFile(path.join(evalDir, "tsconfig.json"), templates.tsconfig());
  writeFile(path.join(evalDir, ".gitignore"), templates.gitignore());
  writeFile(path.join(evalDir, "types.ts"), templates.types());
  writeFile(path.join(evalDir, "eval.config.ts"), templates.evalConfig());
  writeFile(path.join(evalDir, "eval.ts"), templates.evalScript());
  writeFile(path.join(evalDir, "plugins", `${ext.name}.ts`), templates.pluginSkeleton(ext.name, ext.extensionPath));
  writeFile(path.join(evalDir, "trials", "example", "config.ts"), templates.trialConfig(ext.name));
  writeFile(path.join(evalDir, "trials", "example", "task.md"), templates.taskMd());

  console.log(`Created eval harness in eval/`);
  console.log("");
  console.log("Next steps:");
  console.log("  cd eval");
  console.log("  npm install");
  console.log(`  # Edit plugins/${ext.name}.ts to implement scoring`);
  console.log("  # Edit trials/example/task.md with a real task");
  console.log("  npm run eval -- run --trial example --variant default");
}
