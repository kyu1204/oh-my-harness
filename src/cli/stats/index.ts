import { render } from "ink";
import React from "react";
import { loadStatsData } from "./data.js";
import { App } from "./App.js";

export interface StatsCommandOptions {
  projectDir?: string;
}

export async function statsCommand(options: StatsCommandOptions = {}): Promise<void> {
  const projectDir = options.projectDir ?? process.cwd();
  const data = await loadStatsData(projectDir);

  const { waitUntilExit } = render(React.createElement(App, { initialData: data, projectDir }));
  await waitUntilExit();
}
