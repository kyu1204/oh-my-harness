#!/usr/bin/env node
import { createCli } from "../cli/index.js";

const cli = createCli();
cli.parse(process.argv);
