export type RuntimeName = 'claude' | 'openai' | 'gemini';

export type CompanyRuntimeSettingsResponse = {
  company_id: string;
  company_name: string;
  primary_runtime: RuntimeName;
  fallback_order: RuntimeName[];
  system_defaults: {
    primary_runtime: RuntimeName;
    fallback_order: RuntimeName[];
  };
  available_runtimes: RuntimeName[];
};

export type CompanyRuntimeSettingsUpdate = {
  primary_runtime: RuntimeName;
  fallback_order: RuntimeName[];
};

export type CompanyDigestSettingsResponse = {
  company_id: string;
  company_name: string;
  enabled: boolean;
  hour_utc: number;
  minute_utc: number;
  system_defaults: {
    enabled: boolean;
    hour_utc: number;
    minute_utc: number;
  };
};

export type CompanyDigestSettingsUpdate = {
  enabled: boolean;
  hour_utc: number;
  minute_utc: number;
};
