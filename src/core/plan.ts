/**
 * Shared types for the generator "plan" path.
 *
 * Generators compute their final file contents by reading the project's
 * existing files (managed-section merges, permission preservation, etc.) and
 * then either WRITE them (the sync path) or RETURN them (the plan path used by
 * `omh sync --check` / `omh diff` / drift detection). A single compute function
 * per generator backs both, so the plan can never disagree with what sync would
 * actually write.
 */
export interface PlannedFile {
  /** Absolute path the file would be written to. */
  path: string;
  /** Final content that would be written. */
  content: string;
  /** Optional POSIX mode to chmod after writing (e.g. 0o755 for hook scripts). */
  chmod?: number;
}

export interface GenerationPlan {
  /** Files that would be created or overwritten. */
  files: PlannedFile[];
  /** Absolute paths of stale files that would be removed (e.g. dropped hooks). */
  wouldDelete: string[];
}
