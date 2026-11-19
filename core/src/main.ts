#!/usr/bin/env node
import { executable } from "./process.ts";

if (!process.execve) throw new Error("Start Core directly with bin/atlas-core on this platform");
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) env[key] = value;
}
process.execve(executable, [executable, ...process.argv.slice(2)], env);
