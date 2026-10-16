// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * What the browser harness and check-browsers.ts must agree on. A module of its own: harness.ts
 * starts its run when it loads, so the host may only import TYPES from it.
 */

/** How many corpus modules the browser recipe runs on (the first ones that assemble). */
export const RECIPE_MODULES = 3;
