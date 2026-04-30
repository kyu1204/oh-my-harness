#!/usr/bin/env node
import { createRequire } from "node:module";
import { createCli } from "../cli/index.js";
import { notifyIfUpdateAvailable } from "../cli/version-notifier.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { name: string; version: string };

notifyIfUpdateAvailable({ name: pkg.name, version: pkg.version });

const cli = createCli();
cli.parse(process.argv);
