export interface ProjectFacts {
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  testCommands: string[];
  lintCommands: string[];
  buildCommands: string[];
  typecheckCommands: string[];
  blockedPaths: string[];
  detectedFiles: string[];
}

export interface Detector {
  name: string;
  detect(projectDir: string): Promise<Partial<ProjectFacts>>;
}

export function emptyFacts(): ProjectFacts {
  return {
    languages: [],
    frameworks: [],
    packageManagers: [],
    testCommands: [],
    lintCommands: [],
    buildCommands: [],
    typecheckCommands: [],
    blockedPaths: [],
    detectedFiles: [],
  };
}

export function mergeFacts(base: ProjectFacts, partial: Partial<ProjectFacts>): ProjectFacts {
  return {
    languages: [...base.languages, ...(partial.languages ?? [])],
    frameworks: [...base.frameworks, ...(partial.frameworks ?? [])],
    packageManagers: [...base.packageManagers, ...(partial.packageManagers ?? [])],
    testCommands: [...base.testCommands, ...(partial.testCommands ?? [])],
    lintCommands: [...base.lintCommands, ...(partial.lintCommands ?? [])],
    buildCommands: [...base.buildCommands, ...(partial.buildCommands ?? [])],
    typecheckCommands: [...base.typecheckCommands, ...(partial.typecheckCommands ?? [])],
    blockedPaths: [...base.blockedPaths, ...(partial.blockedPaths ?? [])],
    detectedFiles: [...base.detectedFiles, ...(partial.detectedFiles ?? [])],
  };
}
