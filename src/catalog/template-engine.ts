import Handlebars from "handlebars";
import type { BuildingBlock } from "./types.js";

export function renderTemplate(template: string, params: Record<string, unknown>): string {
  const compiled = Handlebars.compile(template);
  return compiled(params);
}

export function validateParams(
  block: BuildingBlock,
  params: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  for (const param of block.params) {
    const value = params[param.name];

    if (param.required && (value === undefined || value === null)) {
      errors.push(`Missing required param: ${param.name}`);
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    const actualType = typeof value;

    if (param.type === "string" && actualType !== "string") {
      errors.push(`Param "${param.name}" must be a string, got ${actualType}`);
    } else if (param.type === "boolean" && actualType !== "boolean") {
      errors.push(`Param "${param.name}" must be a boolean, got ${actualType}`);
    } else if (param.type === "number" && actualType !== "number") {
      errors.push(`Param "${param.name}" must be a number, got ${actualType}`);
    } else if (param.type === "string[]") {
      if (!Array.isArray(value)) {
        errors.push(`Param "${param.name}" must be an array`);
      } else if (!value.every((v: unknown) => typeof v === "string")) {
        errors.push(`All elements in "${param.name}" must be strings`);
      }
    }
  }

  return errors;
}
