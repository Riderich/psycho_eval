/**
 * One-off appendix screenshot: serves nothing by itself—run a static server on port 8765 first:
 *   python -m http.server 8765
 * from the supporter_evaluate directory, then:
 *   npx --yes -p playwright node scripts/capture_appendix.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const out = path.join(root, "docs", "evaluation_interface_appendix.png");
const base = process.env.BASE_URL || "http://127.0.0.1:8765";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
await page.goto(`${base}/index.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.locator("#userId").fill("appendix_demo");
await page.locator("#annotatorName").fill("Appendix");
await page.locator("#startButton").click();
await page.waitForFunction(
  () => {
    const ev = document.getElementById("evaluationContainer");
    return ev && !ev.classList.contains("hidden");
  },
  null,
  { timeout: 120000 }
);
await page.waitForTimeout(2500);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("Wrote", out);
