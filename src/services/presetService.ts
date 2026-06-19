import _ from 'lodash';
import { getRequest } from '../utils/http';
import { debridServicesInfo, isValidApiKey } from '../utils/debrid';
import { isValidManifestUrl } from '../utils/url.ts';
import {
  setAddonCollection,
  pushCollections,
  type Platform
} from '../api/platformApi';
import type { DebridEntry, AddonConfigContext, AdvancedOptions } from './addons';
import { configureAioMetadata, configureAioStreams } from './addons';
import { LOCALE_MESSAGES } from '../locales';

function translateCollections(collections: any[], language: string): any[] {
  const lang = language.split('-')[0] || 'es';
  const messages = LOCALE_MESSAGES[lang] ?? LOCALE_MESSAGES['es'] ?? {};
  return collections.map((collection) => {
    const key =
      'nuvio_collection_' +
      (collection.title as string).toLowerCase().replace(/\s+/g, '_');
    if (messages[key]) {
      return { ...collection, title: messages[key] };
    }
    return collection;
  });
}

interface BuildPresetServiceParams {
  preset: string;
  language: string;
  customAddons: string[];
  options: string[];
  maxSize: string | number;
  advanced?: AdvancedOptions;
  debridEntries?: DebridEntry[];
  password: string;
  platform?: Platform;
}

export async function buildPresetService(params: BuildPresetServiceParams) {
  const {
    preset,
    language,
    customAddons,
    options,
    maxSize,
    advanced = {},
    debridEntries = [],
    password,
    platform = 'stremio'
  } = params;

  const errors: string[] = [];

  const data: any = await getRequest(`${import.meta.env.BASE_URL}preset.json`);
  if (!data) throw new Error('Failed to fetch presets');

  let no4k = options.includes('no4k');
  let cached = options.includes('cached');
  let kids = options.includes('kids');
  let limit = 10;
  let size = maxSize ? maxSize : '';
  let presetKeys = data.presets[preset];

  let presetData =
    language === 'en'
      ? data.languages[language]
      : _.merge({}, data.languages.en, data.languages[language]);

  let presetConfig: any = _.pick(presetData, presetKeys);

  // Custom addons
  if (customAddons.length > 0) {
    for (const [idx, addon] of customAddons.entries()) {
      try {
        if (!addon?.trim()) {
          continue;
        }

        if (!isValidManifestUrl(addon)) {
          errors.push(
            `Custom addon ${idx + 1}: Invalid manifest URL (${addon})`
          );
          continue;
        }
        const addonData: any = await getRequest(addon);
        if (addonData) {
          presetConfig[`customAddon${idx}`] = {
            transportUrl: addon,
            manifest: addonData
          };
        } else {
          errors.push(
            `Custom addon ${idx + 1}: No data received from ${addon}`
          );
        }
      } catch (e) {
        errors.push(
          `Custom addon ${idx + 1}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  // Configure AIOMetadata
  try {
    await configureAioMetadata(
      presetConfig,
      data,
      language,
      kids,
      password,
      advanced,
      platform
    );
  } catch (e) {
    errors.push(`AIOMetadata: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Normalize and validate debrid services
  const validatedDebridEntries: DebridEntry[] = (debridEntries || [])
    .filter((debrid) => debrid && debrid.service && debrid.key)
    .filter((debrid) => isValidApiKey(debrid.service, debrid.key));

  // Debrid service name for manifest suffixes
  const debridServiceName =
    validatedDebridEntries.length > 0
      ? validatedDebridEntries
          .map(
            (debrid) =>
              debridServicesInfo[debrid.service]?.name || debrid.service
          )
          .join(' + ')
      : '';

  // Create context for addon configurations
  const context: AddonConfigContext = {
    language,
    no4k,
    cached,
    limit,
    size,
    debridEntries: validatedDebridEntries,
    debridServiceName,
    password,
    advanced
  };

  // AIOStreams
  try {
    await configureAioStreams(presetConfig, context);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    delete presetConfig.aiostreams;
  }

  const selectedAddons = Object.keys(presetConfig).map((k) => presetConfig[k]);

  if (selectedAddons.length === 0 && errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  if (errors.length > 0) {
    console.warn('Errors during preset configuration:', errors.join('\n'));
  }

  return {
    presetConfig,
    selectedAddons,
    debridServiceName,
    collections: kids
      ? []
      : translateCollections(data.nuvioCollectionsConfig || [], language),
    errors
  };
}

interface LoadPresetServiceParams {
  addons: any[];
  key: string;
  platform?: Platform;
  collections?: any;
  profileId?: number;
}

export async function loadPresetService({
  addons,
  key,
  platform = 'stremio',
  collections = [],
  profileId = 1
}: LoadPresetServiceParams) {
  if (!key) {
    throw new Error('No auth key provided');
  }

  const res = await setAddonCollection(platform, addons, key, profileId);
  if (!res?.result?.success) {
    throw new Error(res?.result?.error || 'Addons sync failed');
  }

  if (platform === 'nuvio') {
    const collectionsSyncRes = await pushCollections(
      collections,
      key,
      profileId
    );
    if (!collectionsSyncRes?.result?.success) {
      throw new Error(
        collectionsSyncRes?.result?.error || 'Collections sync failed'
      );
    }
  }

  return res;
}
