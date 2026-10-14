// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Drives real browsers through Playwright (open-work 28.3; owner, 2026-10-13: "Playwright").
 * Runs on NODE, which Playwright supports (`check-browsers.ts`, on Bun, builds and serves the page
 * and starts this on the referee Node). For each browser spec: launch it headless, open the page,
 * wait for the harness's `__result`, and print one JSON line, `{ name, version, result }` or
 * `{ name, error }`.
 *
 *   node scripts/browsers/driver.ts <page-url> '<BrowserSpec[] as JSON>'
 */

import process from 'node:process';
import { chromium, firefox, type Page, webkit } from 'playwright';

/** One browser to run: an engine Playwright drives, and how to find this browser's build. */
export interface BrowserSpec {
  name: string;
  engine: 'chromium' | 'firefox' | 'webkit';
  /** An installed Chrome / Edge, by Playwright channel (`chrome`, `msedge`). */
  channel?: string;
  /** Any other Chromium-based browser (Brave, Opera): its executable. */
  executablePath?: string;
}

const ENGINES = { chromium, firefox, webkit };
const [url, specsJson] = process.argv.slice(2);
if (!url || !specsJson) {
  console.error('usage: node driver.ts <page-url> <BrowserSpec[] JSON>');
  process.exit(2);
}
/**
 * `p`, or a rejection after `ms`. The timer also keeps the process alive: a promise that never
 * settled let Node exit 13 with no output (Vivaldi's `newPage()` on CI, 2026-10-13; Vivaldi is
 * no longer run).
 */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_ok, bad) => {
    timer = setTimeout(() => bad(new Error(`${what} did not settle in ${ms / 1000} s`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Launches the spec's browser and opens a page: the page, the browser's version, and a closer. */
async function open(spec: BrowserSpec): Promise<{
  page: Page;
  version: string;
  close: () => Promise<void>;
}> {
  const options = {
    headless: true,
    ...(spec.channel ? { channel: spec.channel } : {}),
    ...(spec.executablePath ? { executablePath: spec.executablePath } : {}),
  };
  const browser = await within(ENGINES[spec.engine].launch(options), 120_000, 'the launch');
  try {
    const page = await within(browser.newPage(), 60_000, 'newPage');
    return { page, version: browser.version(), close: () => browser.close() };
  } catch (e) {
    await within(browser.close(), 30_000, 'close').catch(() => {});
    throw e;
  }
}

for (const spec of JSON.parse(specsJson) as BrowserSpec[]) {
  try {
    const { page, version, close } = await open(spec);
    // Every step bounded and named, so a step that never settles is reported by name (Vivaldi on
    // CI exited 13 in silence before this).
    try {
      const consoleErrors: string[] = [];
      page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));
      await within(page.goto(url, { waitUntil: 'load' }), 60_000, 'goto');
      await within(
        page.waitForFunction(
          () => (globalThis as { __result?: unknown }).__result !== undefined,
          null,
          {
            timeout: 20 * 60_000,
            polling: 1000,
          },
        ),
        21 * 60_000,
        'waiting for the harness',
      );
      const result = await within(
        page.evaluate(() => (globalThis as { __result?: unknown }).__result),
        60_000,
        'reading the result',
      );
      console.log(
        JSON.stringify({ name: spec.name, version, result, consoleErrors }),
      );
    } finally {
      await within(close(), 30_000, 'close').catch(() => {});
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
