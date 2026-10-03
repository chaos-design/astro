interface RuntimeConfigDiagnostic {
  level: "warning";
  code: string;
  file: string;
  field?: string;
  message: string;
}

interface RuntimeConfigOptions {
  astroHome?: string;
  environment?: Record<string, string | undefined>;
  home?: string;
  initialize?: boolean;
  overrides?: Record<string, string | undefined>;
  pluginDir?: string;
  strictInitialization?: boolean;
  templateDir?: string;
}

interface RuntimeConfigResult {
  config: {
    version: number;
    server: {
      host: string;
      port: number;
      maxBodyBytes: number;
    };
    runtime: {
      autoOpen: boolean;
    };
    storage: {
      traceDir: string | null;
      projectDir: string | null;
    };
    clients: {
      codex: { home: string };
      claude: { home: string };
      deepseek: { home: string; command: string };
      workbuddy: { home: string; command: string };
    };
    integrations: Record<string, unknown>;
  };
  diagnostics: RuntimeConfigDiagnostic[];
  environment: Record<string, string | undefined>;
  files: {
    config: { exists: boolean; path: string; valid: boolean };
    env: { exists: boolean; path: string; valid: boolean };
  };
  initialization: {
    astroHome: string;
    configCreated: boolean;
    configFile: string;
    envCreated: boolean;
    envFile: string;
    pluginDir: string;
  } | null;
  paths: {
    astroHome: string;
    configFile: string;
    envFile: string;
    pluginDir: string;
  };
  sources: Record<string, string>;
}

declare const runtimeConfigLoader: {
  formatRuntimeConfigDiagnostic(
    diagnostic: RuntimeConfigDiagnostic,
  ): string;
  initializeRuntimeConfig(
    options?: RuntimeConfigOptions,
  ): NonNullable<RuntimeConfigResult["initialization"]>;
  loadRuntimeConfig(options?: RuntimeConfigOptions): RuntimeConfigResult;
  resolveRuntimeConfigPaths(
    environment?: Record<string, string | undefined>,
    options?: RuntimeConfigOptions,
  ): RuntimeConfigResult["paths"];
};

export = runtimeConfigLoader;
