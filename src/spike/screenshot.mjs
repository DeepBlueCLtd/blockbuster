/**
 * THROWAWAY dev tool for the 3D temporal spike — captures headless screenshots
 * of both layouts so the WebGL render can be eyeballed without a display.
 *
 * Standard Playwright browser downloads are blocked in this cloud env, so this
 * uses the bundled @sparticuz/chromium binary + software-WebGL flags. Loopback
 * URLs work (external ones don't). One-off setup (not added to package.json):
 *
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save playwright @sparticuz/chromium
 *   npm run build && npm run preview -- --port 4173 --host 127.0.0.1 &
 *   node src/spike/screenshot.mjs
 *
 * Output: spike-stack.png, spike-grid.png in the cwd.
 */
import { chromium } from 'playwright';
import sparticuz from '@sparticuz/chromium';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/temporal3d.html';
const execPath = await sparticuz.executablePath();
console.log('chromium:', execPath);

const browser = await chromium.launch({
  executablePath: execPath,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--no-zygote',
    '--disable-dev-shm-usage',
    '--no-proxy-server',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(3000); // let the scene build + settle
await page.screenshot({ path: 'spike-stack.png' });
console.log('saved spike-stack.png');

await page.getByRole('button', { name: 'Grid 5×4' }).click();
await page.waitForTimeout(2500); // morph + settle
await page.screenshot({ path: 'spike-grid.png' });
console.log('saved spike-grid.png');

console.log('--- page console ---');
console.log(logs.join('\n') || '(none)');
await browser.close();
