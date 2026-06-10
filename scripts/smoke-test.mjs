import { chromium } from 'playwright';

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

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

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
      title,
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
