#!/usr/bin/env npx tsx
import { createCli } from "../src/cli/index.js";

const cli = createCli();
cli.parse(process.argv);
