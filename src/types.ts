/**
 * Shared leaf types. Put things here when multiple modules need the
 * same nominal type and a natural "owner" doesn't exist — avoids
 * forcing leaf renderers (help.ts, guide.ts) to depend on the CLI
 * entrypoint just to pull one union.
 */

export type CategoryName = "workflow" | "skills" | "recommended" | "plugins" | "hooks";

export const CATEGORY_NAMES: readonly CategoryName[] = [
  "workflow",
  "skills",
  "recommended",
  "plugins",
  "hooks",
] as const;
