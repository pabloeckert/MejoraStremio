<script setup>
import { ref, computed } from 'vue';
import { addNotification } from '../composables/useNotifications';
import {
  buildPresetService,
  loadPresetService
} from '../services/presetService.ts';
import { generatePassword } from '../utils/password.ts';
import { isValidManifestUrl } from '../utils/url.ts';

const STREAMING_CATALOGS_URL =
  'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json';

const props = defineProps({
  authKey: { type: String, default: '' },
  platform: { type: String, default: 'stremio' }
});

const currentStep = ref(1);
const tmdbKey = ref('');
const subsenseUrl = ref('');
const isInstalling = ref(false);
const generatedPassword = ref(generatePassword());

const tmdbKeyValid = computed(() => tmdbKey.value.trim().length >= 8);
const subsenseUrlValid = computed(() =>
  isValidManifestUrl(subsenseUrl.value.trim())
);

const ADDONS_SUMMARY = [
  {
    name: 'AIOMetadata',
    description:
      'Metadata profunda: TMDB + TVDB, Fanart.tv, ratings IMDb, TVmaze para series en curso. Catálogos propios: Argentina, Latinoamérica.'
  },
  {
    name: 'AIOStreams',
    description:
      'Torrents P2P gratuitos: Comet (público), StremThru Torz, MediaFusion (free), Torrentio (sin key).'
  },
  {
    name: 'Streaming Catalogs',
    description:
      'Catálogos de Netflix, HBO Max, Disney+, Prime Video, Apple TV+, Hulu, Peacock y más.'
  },
  {
    name: 'SubSense',
    description:
      'Subtítulos en español (es-AR y es-419) sin SDH, desde tu URL configurada.'
  }
];

async function install() {
  if (!props.authKey) {
    addNotification('Iniciá sesión en Stremio arriba antes de instalar.', 'error');
    return;
  }

  isInstalling.value = true;

  try {
    const { selectedAddons, collections, errors } = await buildPresetService({
      preset: 'pablo-free',
      language: 'es-MX',
      customAddons: [STREAMING_CATALOGS_URL, subsenseUrl.value.trim()],
      options: [],
      maxSize: '',
      advanced: { tmdbKey: tmdbKey.value.trim() },
      debridEntries: [],
      password: generatedPassword.value,
      platform: props.platform
    });

    if (errors.length > 0) {
      addNotification(errors.join('\n'), 'warning');
    }

    // Los dos addons principales (AIOMetadata + AIOStreams) se configuran contra
    // servicios externos. Si ambos fallan, selectedAddons solo tendría los custom
    // addons y sobrescribiría la cuenta con 1-2 entradas o incluso 0.
    // Requerimos al menos 3 para garantizar que la configuración es válida.
    if (selectedAddons.length < 3) {
      throw new Error(
        'La configuración resultó en muy pocos addons (' +
          selectedAddons.length +
          '). Revisá los errores anteriores y reintentá.'
      );
    }

    await loadPresetService({
      addons: selectedAddons,
      key: props.authKey,
      platform: props.platform,
      collections
    });

    currentStep.value = 4;
  } catch (error) {
    addNotification(
      error instanceof Error ? error.message : 'Error al instalar los addons.',
      'error'
    );
  } finally {
    isInstalling.value = false;
  }
}
</script>

<template>
  <section id="configure" class="max-w-4xl mx-auto p-4">
    <!-- Header del wizard -->
    <div class="mb-8">
      <h2 class="text-3xl font-bold">Mi Setup</h2>
      <p class="text-base-content/70 mt-2 leading-relaxed">
        Setup 100% gratuito. Metadata profunda de series y películas. Catálogos
        de plataformas y producciones latinoamericanas. Subtítulos en español
        latino sin adaptaciones para sordos.
      </p>
    </div>

    <!-- Barra de progreso -->
    <ul class="steps w-full mb-8 text-sm">
      <li :class="['step', currentStep >= 1 ? 'step-primary' : '']">TMDB</li>
      <li :class="['step', currentStep >= 2 ? 'step-primary' : '']">SubSense</li>
      <li :class="['step', currentStep >= 3 ? 'step-primary' : '']">Instalar</li>
      <li :class="['step', currentStep >= 4 ? 'step-primary' : '']">Listo</li>
    </ul>

    <!-- ── PASO 1: TMDB API Key ── -->
    <div v-if="currentStep === 1">
      <fieldset class="bg-base-100 p-6 rounded-lg border border-base-300 space-y-4">
        <legend class="text-lg font-semibold px-2">
          Paso 1 de 3 — Clave de API de TMDB
        </legend>

        <p class="text-base-content/70">
          Obtené tu key <strong>gratis</strong> en
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer noopener"
            class="link link-primary"
          >
            themoviedb.org → Settings → API
          </a>
          (requiere una cuenta gratuita). Se usa para metadata de películas y series.
        </p>

        <div class="form-control w-full max-w-lg">
          <label class="label">
            <span class="label-text font-medium">Tu TMDB API Key (v3 Auth)</span>
          </label>
          <input
            v-model="tmdbKey"
            type="text"
            placeholder="Pegá tu TMDB API key aquí"
            class="input input-bordered w-full font-mono"
            :class="{ 'input-error': tmdbKey && !tmdbKeyValid }"
            autocomplete="off"
            @keyup.enter="tmdbKeyValid && (currentStep = 2)"
          />
          <label v-if="tmdbKey && !tmdbKeyValid" class="label">
            <span class="label-text-alt text-error">
              La key parece demasiado corta. Revisá que sea la API Key v3.
            </span>
          </label>
        </div>

        <div class="flex justify-end pt-2">
          <button
            class="btn btn-primary"
            :disabled="!tmdbKeyValid"
            @click="currentStep = 2"
          >
            Siguiente →
          </button>
        </div>
      </fieldset>
    </div>

    <!-- ── PASO 2: SubSense URL ── -->
    <div v-if="currentStep === 2">
      <fieldset class="bg-base-100 p-6 rounded-lg border border-base-300 space-y-4">
        <legend class="text-lg font-semibold px-2">
          Paso 2 de 3 — URL de SubSense
        </legend>

        <p class="text-base-content/70">
          Generá tu URL personal en
          <a
            href="https://subsense.nepiraw.com"
            target="_blank"
            rel="noreferrer noopener"
            class="link link-primary"
          >
            subsense.nepiraw.com
          </a>
          con estos ajustes:
        </p>

        <ul class="list-disc list-inside text-sm text-base-content/70 space-y-1 pl-2">
          <li>Seleccioná <strong>es-AR</strong> (español Argentina)</li>
          <li>Seleccioná <strong>es-419</strong> (español Latinoamérica)</li>
          <li>Desactivá <strong>SDH</strong> (subtítulos para sordos e hipoacúsicos)</li>
          <li>Desactivá subtítulos <strong>forzados</strong></li>
          <li>
            Copiá la URL completa del
            <code class="text-primary font-mono text-xs bg-base-200 px-1 rounded"
              >manifest.json</code
            >
            generado
          </li>
        </ul>

        <div class="form-control w-full">
          <label class="label">
            <span class="label-text font-medium">URL de SubSense (manifest.json)</span>
          </label>
          <input
            v-model="subsenseUrl"
            type="text"
            placeholder="https://subsense.nepiraw.com/.../manifest.json"
            class="input input-bordered w-full font-mono text-sm"
            :class="{ 'input-error': subsenseUrl && !subsenseUrlValid }"
            autocomplete="off"
            @keyup.enter="subsenseUrlValid && (currentStep = 3)"
          />
          <label v-if="subsenseUrl && !subsenseUrlValid" class="label">
            <span class="label-text-alt text-error">
              La URL debe ser HTTPS y terminar en <code>/manifest.json</code>
            </span>
          </label>
        </div>

        <div class="flex justify-between pt-2">
          <button class="btn btn-ghost" @click="currentStep = 1">← Anterior</button>
          <button
            class="btn btn-primary"
            :disabled="!subsenseUrlValid"
            @click="currentStep = 3"
          >
            Siguiente →
          </button>
        </div>
      </fieldset>
    </div>

    <!-- ── PASO 3: Resumen e Instalación ── -->
    <div v-if="currentStep === 3">
      <fieldset class="bg-base-100 p-6 rounded-lg border border-base-300 space-y-5">
        <legend class="text-lg font-semibold px-2">
          Paso 3 de 3 — Resumen y confirmación
        </legend>

        <!-- Lista de addons que se instalarán -->
        <div>
          <p class="font-medium mb-3">Addons que se instalarán:</p>
          <div class="space-y-2">
            <div
              v-for="addon in ADDONS_SUMMARY"
              :key="addon.name"
              class="flex items-start gap-3 p-3 rounded-lg bg-base-200"
            >
              <span class="text-success font-bold mt-0.5 shrink-0">✓</span>
              <div>
                <div class="font-semibold text-sm">{{ addon.name }}</div>
                <div class="text-xs text-base-content/60 mt-0.5">
                  {{ addon.description }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Notas de pasos manuales -->
        <div class="space-y-2">
          <div class="alert text-sm py-2">
            <span>
              💡 <strong>AIOLists</strong> (watchlist Trakt + MDBList): configuralo en
              <a
                href="https://aiolists.elfhosted.com"
                target="_blank"
                rel="noreferrer noopener"
                class="link link-primary"
                >aiolists.elfhosted.com</a
              >
              e instalalo desde tu URL configurada.
            </span>
          </div>
          <div class="alert text-sm py-2">
            <span>
              💡 <strong>TuSubtitulo</strong>: instalalo desde el
              <strong>catálogo de complementos de Stremio</strong> (buscá "TuSubtitulo").
            </span>
          </div>
          <div class="alert text-sm py-2">
            <span>
              💡 <strong>Trakt scrobbling</strong>: activalo en
              Stremio → <strong>Configuración → Integraciones</strong>.
            </span>
          </div>
        </div>

        <!-- Advertencia si no está autenticado -->
        <div v-if="!authKey" class="alert alert-warning text-sm">
          <span>⚠️ Necesitás iniciar sesión en tu cuenta de Stremio (arriba) antes de instalar.</span>
        </div>

        <!-- Advertencia de sobrescritura -->
        <div class="alert alert-error text-sm">
          <span>
            ⚠️ <strong>Esta acción sobreescribirá tu configuración actual de addons.</strong>
            Si querés conservarla, hacé un backup desde la sección "Copia de seguridad/Restaurar" antes de continuar.
          </span>
        </div>

        <div class="flex justify-between items-center pt-2">
          <button
            class="btn btn-ghost"
            :disabled="isInstalling"
            @click="currentStep = 2"
          >
            ← Anterior
          </button>
          <button
            class="btn btn-primary btn-lg"
            :disabled="!authKey || isInstalling"
            @click="install"
          >
            <span
              v-if="isInstalling"
              class="loading loading-spinner loading-sm"
            ></span>
            {{ isInstalling ? 'Instalando...' : 'Instalar en Stremio' }}
          </button>
        </div>
      </fieldset>
    </div>

    <!-- ── PASO 4: Instalación completa ── -->
    <div v-if="currentStep === 4">
      <div class="bg-base-100 p-8 rounded-lg border border-base-300 text-center space-y-4">
        <div class="text-6xl">🎉</div>
        <h3 class="text-2xl font-bold">¡Setup instalado exitosamente!</h3>
        <p class="text-base-content/70">
          Tu cuenta de Stremio fue configurada con todos los addons de Mi Setup.
        </p>

        <div class="text-left bg-base-200 rounded-lg p-4 max-w-md mx-auto mt-4">
          <p class="font-semibold mb-3">Próximos pasos:</p>
          <ol class="list-decimal list-inside space-y-2 text-sm text-base-content/70">
            <li><strong>Reiniciá Stremio</strong> para ver los cambios.</li>
            <li>
              Configurá
              <a
                href="https://aiolists.elfhosted.com"
                target="_blank"
                rel="noreferrer noopener"
                class="link link-primary"
                >AIOLists</a
              >
              con tu cuenta de Trakt y MDBList, luego instalalo desde su URL.
            </li>
            <li>
              Instalá <strong>TuSubtitulo</strong> desde el catálogo de
              complementos de Stremio.
            </li>
            <li>
              Activá <strong>Trakt scrobbling</strong> en
              Configuración → Integraciones.
            </li>
          </ol>
        </div>
      </div>
    </div>
  </section>
</template>
