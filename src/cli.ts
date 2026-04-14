#!/usr/bin/env tsx
import { runInit } from "./init.js";

const command = process.argv[2];

if (command === "init") {
  await runInit();
} else if (command === "view") {
  const { EvalServer } = await import("./server.js");
  const port = parseInt(process.env.EVAL_PORT || "4242", 10);
  const server = new EvalServer(".", port);
  server.start();
} else {
  console.log("pi-do-eval");
  console.log("");
  console.log("Commands:");
  console.log("  init    Scaffold an eval harness in the current directory");
  console.log("  view    Start the eval viewer with live updates");
}
