import type { ProjectFacts, Detector } from "./types.js";
import { emptyFacts, mergeFacts } from "./types.js";

export type { ProjectFacts } from "./types.js";

export async function detectProject(
  projectDir: string,
  detectors?: Detector[],
): Promise<ProjectFacts> {
  const activeDetectors = detectors ?? (await loadDefaultDetectors());

  let facts = emptyFacts();

  for (const detector of activeDetectors) {
    try {
      const partial = await detector.detect(projectDir);
      facts = mergeFacts(facts, partial);
    } catch {
      // Detector failure is non-fatal — skip and continue
    }
  }

  // Deduplicate all arrays
  return deduplicateFacts(facts);
}

function deduplicateFacts(facts: ProjectFacts): ProjectFacts {
  return {
    languages: [...new Set(facts.languages)],
    frameworks: [...new Set(facts.frameworks)],
    packageManagers: [...new Set(facts.packageManagers)],
    testCommands: [...new Set(facts.testCommands)],
    lintCommands: [...new Set(facts.lintCommands)],
    buildCommands: [...new Set(facts.buildCommands)],
    typecheckCommands: [...new Set(facts.typecheckCommands)],
    blockedPaths: [...new Set(facts.blockedPaths)],
    detectedFiles: [...new Set(facts.detectedFiles)],
  };
}

async function loadDefaultDetectors(): Promise<Detector[]> {
  const { allDetectors } = await import("./detectors/index.js");
  return allDetectors;
}
