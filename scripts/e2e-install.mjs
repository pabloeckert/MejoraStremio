import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const SITE = 'https://pabloeckert.github.io/MejoraStremio/';
const API = 'https://api.strem.io/api';
const { ST_EMAIL, ST_PASS, TMDB_KEY, SUBSENSE_URL } = process.env;

if (!ST_EMAIL || !ST_PASS || !TMDB_KEY || !SUBSENSE_URL) {
  console.error('Faltan variables de entorno');
  process.exit(1);
}

const api = async (path, body) => {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
};

// 1. Login por API para validar credenciales y obtener authKey
const login = await api('login', {
  authKey: null,
  email: ST_EMAIL,
  password: ST_PASS
});
if (!login?.result?.authKey) {
  console.error('LOGIN FALLIDO:', JSON.stringify(login?.error || login));
  process.exit(1);
}
const authKey = login.result.authKey;
console.error('[1/5] Login por API OK');

// 2. Backup de la colección actual de addons
const before = await api('addonCollectionGet', {
  type: 'AddonCollectionGet',
  authKey,
  update: true
});
const beforeAddons = before?.result?.addons || [];
mkdirSync('.backups', { recursive: true });
const backupFile = `.backups/addons-backup-${Date.now()}.json`;
writeFileSync(backupFile, JSON.stringify(beforeAddons, null, 2));
console.error(`[2/5] Backup: ${beforeAddons.length} addons -> ${backupFile}`);

// 3. Flujo real en el sitio publicado
const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

await page.goto(SITE, { waitUntil: 'networkidle' });

// Login en la UI
await page
  .locator('input[placeholder="Correo electrónico de Stremio"]')
  .fill(ST_EMAIL);
await page.locator('input[placeholder="Contraseña de Stremio"]').fill(ST_PASS);
await page.locator('button:has-text("Iniciar sesión")').click();
await page
  .locator('button:has-text("Sesión iniciada")')
  .waitFor({ timeout: 30000 });
console.error('[3/5] Login en la UI OK');

// Wizard
await page.locator('input[placeholder*="TMDB"]').fill(TMDB_KEY);
await page.locator('button:has-text("Siguiente")').click();
await page.locator('input[placeholder*="subsense"]').fill(SUBSENSE_URL);
await page.locator('button:has-text("Siguiente")').click();

const installBtn = page.locator('button:has-text("Instalar en Stremio")');
if (await installBtn.isDisabled()) {
  console.error('El botón de instalar sigue deshabilitado');
  await browser.close();
  process.exit(1);
}
await installBtn.click();
console.error('[4/5] Instalación lanzada, esperando resultado...');

// Éxito (paso 4) o notificación de error
const success = page.locator('text=¡Setup instalado exitosamente!');
let installed = false;
let notifications = [];
try {
  await success.waitFor({ timeout: 180000 });
  installed = true;
} catch {
  notifications = await page
    .locator('.alert, [class*="toast"], [class*="notification"]')
    .allTextContents();
}
await page.screenshot({
  path: '.screenshots/e2e-install-result.png',
  fullPage: true
});
await browser.close();

// 4. Verificación contra la API
const after = await api('addonCollectionGet', {
  type: 'AddonCollectionGet',
  authKey,
  update: true
});
const afterAddons = (after?.result?.addons || []).map((a) => ({
  name: a.manifest?.name,
  id: a.manifest?.id,
  url: (a.transportUrl || '').split('/').slice(0, 3).join('/')
}));
console.error('[5/5] Verificación por API hecha');

console.log(
  JSON.stringify(
    {
      installedViaWizard: installed,
      notifications,
      consoleErrors,
      backupFile,
      addonsBefore: beforeAddons.map((a) => a.manifest?.name),
      addonsAfter: afterAddons
    },
    null,
    2
  )
);
