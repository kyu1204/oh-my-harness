export interface PresetInfo {
  name: string;
  displayName: string;
  description: string;
  tags: string[];
}

export function buildPresetSelectionPrompt(description: string, presets: PresetInfo[]): string {
  const presetList = presets
    .map(
      (p) =>
        `- name: ${p.name}\n  displayName: ${p.displayName}\n  description: ${p.description}\n  tags: ${p.tags.join(", ")}`,
    )
    .join("\n");

  return `You are a preset selector for oh-my-harness. Given a project description, select the most appropriate presets from the available list. Return ONLY a JSON object with no markdown formatting.

Available presets:
${presetList}

Project description: ${description}

Output format: {"presets": ["preset-name-1", "preset-name-2"], "confidence": 0.9, "explanation": "brief reason"}`;
}

export function buildHarnessGenerationPrompt(description: string): string {
  return `You are a configuration generator for oh-my-harness, an AI code agent harness tool. Given a project description, generate a complete harness.yaml configuration in YAML format. Return ONLY the YAML content with no markdown formatting.

The harness.yaml schema has these fields:
- version: must be "1.0"
- project: object with name (optional string), description (optional string), stacks (array of {name, framework, language, packageManager?, testRunner?, linter?})
- rules: array of {id, title, content (markdown), priority (number, lower = higher in file)}
- enforcement: object with preCommit (array of commands like "test", "lint"), blockedPaths (array of glob patterns), blockedCommands (array of dangerous commands), postSave (array of {pattern, command})
- permissions: object with allow (array of permission strings like "Bash(npm test*)") and deny (array)

Example 1 - Next.js app:
version: "1.0"
project:
  name: my-nextjs-app
  stacks:
    - name: frontend
      framework: nextjs
      language: typescript
      packageManager: pnpm
      testRunner: vitest
      linter: eslint
rules:
  - id: nextjs-rules
    title: "Next.js Rules"
    content: |
      ## Next.js Development Rules
      - Use App Router (app/ directory), never Pages Router
      - All components default to Server Components unless explicitly marked 'use client'
      - Use next/image for all images, next/link for all internal links
    priority: 20
  - id: nextjs-testing
    title: "Next.js Testing"
    content: |
      ## Testing Rules
      - Use vitest + @testing-library/react for component tests
      - Every component MUST have a corresponding .test.tsx file
    priority: 21
enforcement:
  preCommit: ["test", "lint", "build"]
  blockedPaths: [".next/", "node_modules/", "*.min.js"]
  blockedCommands: ["rm -rf /", "sudo rm"]
  postSave:
    - pattern: "*.ts"
      command: "eslint --fix"
    - pattern: "*.tsx"
      command: "eslint --fix"
permissions:
  allow:
    - "Bash(pnpm install*)"
    - "Bash(pnpm test*)"
    - "Bash(pnpm build*)"
  deny:
    - "Bash(rm -rf /)"
    - "Bash(sudo *)"

Example 2 - FastAPI backend:
version: "1.0"
project:
  name: my-api
  stacks:
    - name: backend
      framework: fastapi
      language: python
      packageManager: uv
      testRunner: pytest
      linter: ruff
rules:
  - id: fastapi-rules
    title: "FastAPI Rules"
    content: |
      ## FastAPI Development Rules
      - Use async def for all route handlers
      - Use Pydantic v2 models for all request/response schemas
      - Use dependency injection for database sessions, auth, and shared services
    priority: 20
enforcement:
  preCommit: ["pytest", "ruff check"]
  blockedPaths: ["__pycache__/", ".venv/", "*.pyc"]
  blockedCommands: ["rm -rf /", "sudo rm", "pip install"]
  postSave:
    - pattern: "*.py"
      command: "ruff check --fix"
permissions:
  allow:
    - "Bash(pytest*)"
    - "Bash(uv *)"
    - "Bash(ruff *)"
  deny:
    - "Bash(rm -rf /)"
    - "Bash(sudo *)"
    - "Bash(pip install*)"

Project description: ${description}

Generate a complete harness.yaml for this project. Output ONLY valid YAML.`;
}
