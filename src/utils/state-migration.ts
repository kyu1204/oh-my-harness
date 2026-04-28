import fs from "node:fs/promises";
import path from "node:path";
import {
  OMH_DIR,
  OMH_STATE_DIR,
  OMH_MANIFEST,
  OMH_EVENTS_FILE,
  OMH_TDD_STATE_FILE,
  LEGACY_STATE_DIR,
  LEGACY_HOOKS_DIR,
  LEGACY_MANIFEST,
  LEGACY_TDD_FILE,
  LEGACY_CONFIG_AUDIT_LOG,
} from "./paths.js";
import { pathExists, endsWithNewline } from "./fs-helpers.js";

interface ParsedConfigAudit {
  ts?: string;
  source?: string;
  file?: string;
}

function configAuditToEvent(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: ParsedConfigAudit;
  try {
    parsed = JSON.parse(trimmed) as ParsedConfigAudit;
  } catch {
    return null;
  }
  if (!parsed.ts) return null;
  const meta = { source: parsed.source ?? "unknown", file: parsed.file ?? "unknown" };
  return JSON.stringify({
    ts: parsed.ts,
    event: "ConfigChange",
    hook: "catalog-config-audit.sh",
    decision: "allow",
    reason: "",
    meta,
  });
}

export interface MigrationReport {
  migrated: string[];
  skipped: string[];
}

export async function migrateLegacyState(projectDir: string): Promise<MigrationReport> {
  const report: MigrationReport = { migrated: [], skipped: [] };
  // Only files we actually consumed/copied get unlinked. Files skipped because
  // a destination already exists are preserved so the user can recover them.
  const cleanupTargets = new Set<string>();

  const legacyState = path.join(projectDir, LEGACY_STATE_DIR);
  const newState = path.join(projectDir, OMH_STATE_DIR);
  const legacyManifest = path.join(projectDir, LEGACY_MANIFEST);
  const newManifest = path.join(projectDir, OMH_MANIFEST);

  const hasLegacyState = await pathExists(legacyState);
  const hasLegacyManifest = await pathExists(legacyManifest);

  // Nothing legacy to migrate.
  if (!hasLegacyState && !hasLegacyManifest) {
    return report;
  }

  await fs.mkdir(path.join(projectDir, OMH_DIR), { recursive: true });

  if (hasLegacyState) {
    await fs.mkdir(newState, { recursive: true });

    // events.jsonl — copy if new doesn't exist
    const legacyEvents = path.join(legacyState, OMH_EVENTS_FILE);
    const newEvents = path.join(newState, OMH_EVENTS_FILE);
    if (await pathExists(legacyEvents)) {
      if (!(await pathExists(newEvents))) {
        await fs.copyFile(legacyEvents, newEvents);
        report.migrated.push("events.jsonl");
        cleanupTargets.add(legacyEvents);
      } else {
        report.skipped.push("events.jsonl (destination exists)");
      }
    }

    // edit-history.json → tdd-edits.json
    const legacyTdd = path.join(legacyState, LEGACY_TDD_FILE);
    const newTdd = path.join(newState, OMH_TDD_STATE_FILE);
    if (await pathExists(legacyTdd)) {
      if (!(await pathExists(newTdd))) {
        await fs.copyFile(legacyTdd, newTdd);
        report.migrated.push(`${LEGACY_TDD_FILE} → ${OMH_TDD_STATE_FILE}`);
        cleanupTargets.add(legacyTdd);
      } else {
        report.skipped.push(`${LEGACY_TDD_FILE} (destination exists)`);
      }
    }

    // config-audit.log → append into events.jsonl as ConfigChange entries
    const legacyAuditLog = path.join(legacyState, LEGACY_CONFIG_AUDIT_LOG);
    if (await pathExists(legacyAuditLog)) {
      const raw = await fs.readFile(legacyAuditLog, "utf8");
      const lines = raw.split("\n").map(configAuditToEvent).filter((l): l is string => l !== null);
      if (lines.length > 0) {
        // Guarantee a JSONL boundary newline before appending. If newEvents
        // exists but its last byte isn't \n (truncation, manual edit), the
        // first absorbed entry would otherwise glue onto the last record
        // and break parsing for the whole file.
        const prefix = (await pathExists(newEvents)) && !(await endsWithNewline(newEvents))
          ? "\n"
          : "";
        await fs.appendFile(newEvents, prefix + lines.join("\n") + "\n", "utf8");
        report.migrated.push(`${LEGACY_CONFIG_AUDIT_LOG} → events.jsonl (${lines.length} entries)`);
        cleanupTargets.add(legacyAuditLog);
      } else {
        report.skipped.push(`${LEGACY_CONFIG_AUDIT_LOG} (no valid lines)`);
      }
    }
  }

  // Manifest migration runs whether or not the .state dir exists — a user
  // who synced but never fired a hook still has manifest at the legacy path.
  if (hasLegacyManifest) {
    if (!(await pathExists(newManifest))) {
      await fs.copyFile(legacyManifest, newManifest);
      report.migrated.push("manifest.json");
      cleanupTargets.add(legacyManifest);
    } else {
      report.skipped.push("manifest.json (destination exists)");
    }
  }

  // Cleanup only files we actually migrated.
  for (const p of cleanupTargets) {
    try {
      await fs.unlink(p);
    } catch {
      // ignore
    }
  }
  // Try to remove now-empty .claude/hooks/.state and parent .claude/hooks if empty
  for (const dir of [legacyState, path.join(projectDir, LEGACY_HOOKS_DIR)]) {
    try {
      await fs.rmdir(dir);
    } catch {
      // not empty or missing — fine
    }
  }

  return report;
}
