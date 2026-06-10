import { chromium } from 'playwright';

// URL objetivo como primer argumento; por defecto el dev server local
const targetUrl = process.argv[2] || 'http://localhost:5173/';

const errors = [];
const pageErrors = [];
const failedRequests = [];

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('requestfailed', (req) =>
  failedRequests.push(`${req.url()} :: ${req.failure()?.errorText}`)
);

await page.goto(targetUrl, { waitUntil: 'networkidle' });

// preset.json debe resolver bajo el base path, igual que lo pide la app
const presetCheck = await page.evaluate(async () => {
  const url = new URL('preset.json', location.href).href;
  try {
    const res = await fetch(url);
    if (!res.ok) return { url, ok: false, status: res.status };
    const data = await res.json();
    return {
      url,
      ok: true,
      hasPabloFree: 'pablo-free' in (data.presets || {})
    };
  } catch (e) {
    return { url, ok: false, error: String(e) };
  }
});

const title = await page.title();
const wizardVisible = await page.locator('#configure').isVisible();
const heading = await page.locator('#configure h2').textContent();
const stepCount = await page.locator('.steps .step').count();

// Paso 1: la key de TMDB habilita el botón Siguiente
const nextBtn = page.locator('button:has-text("Siguiente")');
const disabledBefore = await nextBtn.isDisabled();
await page.locator('input[placeholder*="TMDB"]').fill('abcdef1234567890');
const disabledAfter = await nextBtn.isDisabled();
await nextBtn.click();
const step2Visible = await page
  .locator('legend:has-text("Paso 2 de 3")')
  .isVisible();

// Paso 2: URL de SubSense valida y avanza
await page
  .locator('input[placeholder*="subsense"]')
  .fill('https://subsense.nepiraw.com/abc123/manifest.json');
await page.locator('button:has-text("Siguiente")').click();
const step3Visible = await page
  .locator('legend:has-text("Paso 3 de 3")')
  .isVisible();
const installBtnDisabled = await page
  .locator('button:has-text("Instalar en Stremio")')
  .isDisabled();

await page.screenshot({ path: '.screenshots/smoke-step3.png', fullPage: true });
await browser.close();

console.log(
  JSON.stringify(
    {
      targetUrl,
      title,
      presetCheck,
      wizardVisible,
      heading: heading?.trim(),
      stepCount,
      tmdbGate: { disabledBefore, disabledAfter },
      step2Visible,
      step3Visible,
      installBtnDisabledWithoutAuth: installBtnDisabled,
      consoleErrors: errors,
      pageErrors,
      failedRequests
    },
    null,
    2
  )
);
