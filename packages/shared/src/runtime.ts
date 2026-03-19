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
