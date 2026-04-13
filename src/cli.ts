#!/usr/bin/env tsx
import { runInit } from "./init.js";

const command = process.argv[2];

if (command === "init") {
  await runInit();
} else {
  console.log("pi-do-eval");
  console.log("");
  console.log("Commands:");
  console.log("  init    Scaffold an eval harness in the current directory");
}
