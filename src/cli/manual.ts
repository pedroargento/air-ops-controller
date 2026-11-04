import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

/*
 * Prints the manual (docs/manual/manual.html) to docs/manual/air-operations-manual.pdf, one
 * 120 mm square page per booklet page. `--pages dir` also saves each page as a PNG for checking.
 */

const source = resolve('docs/manual/manual.html');
const output = resolve('docs/manual/air-operations-manual.pdf');
const pagesAt = process.argv.indexOf('--pages');
const pagesDir = pagesAt > 0 ? process.argv[pagesAt + 1] : undefined;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (pagesDir !== undefined) {
    const pages = await page.locator('.page').all();
    for (const [index, element] of pages.entries()) await element.screenshot({ path: `${pagesDir}/${String(index + 1).padStart(2, '0')}.png` });
    console.log(`saved ${pages.length} page images to ${pagesDir}`);
  }
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: output, preferCSSPageSize: true, printBackground: true });
  console.log(`wrote ${output}`);
} finally {
  await browser.close();
}
