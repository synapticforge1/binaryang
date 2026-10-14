// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Drives real browsers through Playwright (open-work 28.3; owner, 2026-10-14: "Playwright").
 * Runs on NODE, which Playwright supports (`check-browsers.ts`, on Bun, builds and serves the page
 * and starts this on the referee Node). For each browser spec: launch it headless, open the page,
 * wait for the harness's `__result`, and print one JSON line, `{ name, version, result }` or
 * `{ name, error }`.
 *
 *   node scripts/browsers/driver.ts <page-url> '<BrowserSpec[] as JSON>'
 */

import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

/** One browser to run: an engine Playwright drives, and how to find this browser's build. */
export interface BrowserSpec {
  name: string;
  engine: 'chromium' | 'firefox' | 'webkit';
  /** An installed Chrome / Edge, by Playwright channel (`chrome`, `msedge`). */
  channel?: string;
  /** Any other Chromium-based browser (Brave, Opera, Vivaldi): its executable. */
  executablePath?: string;
}

const ENGINES = { chromium, firefox, webkit };
const [url, specsJson] = process.argv.slice(2);
if (!url || !specsJson) {
  console.error('usage: node driver.ts <page-url> <BrowserSpec[] JSON>');
  process.exit(2);
}
for (const spec of JSON.parse(specsJson) as BrowserSpec[]) {
  try {
    const browser = await ENGINES[spec.engine].launch({
      headless: true,
      ...(spec.channel ? { channel: spec.channel } : {}),
      ...(spec.executablePath ? { executablePath: spec.executablePath } : {}),
    });
    try {
      const page = await browser.newPage();
      const consoleErrors: string[] = [];
      page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(
        () => (globalThis as { __result?: unknown }).__result !== undefined,
        null,
        {
          timeout: 20 * 60_000,
          polling: 1000,
        },
      );
      const result = await page.evaluate(() => (globalThis as { __result?: unknown }).__result);
      console.log(
        JSON.stringify({ name: spec.name, version: browser.version(), result, consoleErrors }),
      );
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.log(
      JSON.stringify({
        name: spec.name,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 400),
      }),
    );
  }
}
