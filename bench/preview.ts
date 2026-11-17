/** The bench's check on itself: the same presses, timed the same way, on
 *  the app as built and served (`vite build`, `vite preview`), driven as a
 *  person drives it. What `edit.test.ts` reports should agree with this.
 *
 *    bun run build && bun run preview --port 4173 --strictPort &
 *    bun bench/preview.ts
 */

import { chromium, type Page } from "playwright";

const URL = process.env.BENCH_URL ?? "http://localhost:4173";
const BOOK = ".vitest/bench/book.pdf";
const RUNS = 6;

/** In the page: press the button offered for `actions`, timed to the frame
 *  painted after it. */
async function press(page: Page, actions: string[]): Promise<number> {
  return page.evaluate(async (actions) => {
    const button = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-block-actions]:not([hidden]) button",
      ),
    ).find((b) => actions.includes(b.dataset.action ?? ""));
    if (!button) throw new Error(`no ${actions.join("/")} button`);
    const t0 = performance.now();
    button.click();
    await new Promise<void>((r) =>
      requestAnimationFrame(() => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => r();
        ch.port2.postMessage(0);
      }),
    );
    return performance.now() - t0;
  }, actions);
}

async function scenario(
  page: Page,
  name: string,
  box: string,
  actions: string[],
) {
  // Picked and pointed at on the page, where every action is offered.
  const el = page.locator(`[data-paper] [data-block="${box}"]`);
  if (!(await el.evaluate((e) => e.classList.contains("selection"))))
    await el.click();
  await el.hover();
  await page.waitForTimeout(500);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    times.push(await press(page, actions));
    await page.waitForTimeout(1000);
  }
  const median = [...times].sort((a, b) => a - b)[RUNS >> 1];
  console.log(`${name.padEnd(28)} paint ${Math.round(median)}ms`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await page.goto(URL);
  await page.locator("input[type=file][accept]").setInputFiles(BOOK);
  await page.getByRole("button", { name: "Create new workspace" }).click();
  await page.waitForURL(/\/edit/);
  await page.goto(`${URL}/edit/book`);
  await page.waitForSelector('article.markdown[aria-busy="false"]', {
    timeout: 600_000,
  });
  // The sixth block the page pane numbers on the first page with any.
  const box = await page
    .locator("[data-paper] .pick")
    .nth(5)
    .getAttribute("data-block");
  if (!box) throw new Error("no block on the first pages");
  console.log(`production build at ${URL}, block ${box}`);

  await scenario(page, "rendered: hide early", box, ["hide", "show"]);
  await scenario(page, "rendered: delete early", box, ["delete", "restore"]);
  await page.getByRole("radio", { name: "raw" }).click();
  await page.waitForSelector('div[aria-busy="false"]:has(> ol.source)', {
    timeout: 600_000,
  });
  await page.waitForTimeout(2000);
  await scenario(page, "raw: hide early", box, ["hide", "show"]);
  await scenario(page, "raw: delete early", box, ["delete", "restore"]);
} finally {
  await browser.close();
}
