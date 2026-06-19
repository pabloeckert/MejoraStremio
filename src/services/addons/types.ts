import { debridServicesInfo } from '../../utils/debrid';

export interface DebridEntry {
  service: keyof typeof debridServicesInfo;
  key: string;
}

export interface AddonConfigContext {
  language: string;
  no4k: boolean;
  cached: boolean;
  limit: number;
  size: string | number;
  debridEntries: DebridEntry[];
  debridServiceName: string;
  password?: string;
  advanced?: AdvancedOptions;
}

export interface AdvancedOptions {
  rpdbKey?: string;
  tmdbKey?: string;
}
