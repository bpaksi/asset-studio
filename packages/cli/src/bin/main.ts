#!/usr/bin/env node
import { main } from "./cli.js";

process.exitCode = main(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
