const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const maxConfigBytes = 65_536;
const supportedVersion = 1;
const environmentNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const interpolationPattern =
  /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g;

function loadDependency(name) {
  try {
    return require(path.join(__dirname, "vendor", name));
  } catch (error) {
    if (error?.code !== "MODULE_NOT_FOUND") {
      throw error;
    }
    return require(name);
  }
}

const dotenv = loadDependency("dotenv");
const yaml = loadDependency("yaml");

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function expandHome(value, home = os.homedir()) {
  if (value === "~") {
    return home;
  }
  if (typeof value === "string" && value.startsWith("~/")) {
    return path.join(home, value.slice(2));
  }
  return value;
}

function resolveRuntimeConfigPaths(
  environment = process.env,
  { astroHome, home = os.homedir(), pluginDir } = {},
) {
  const configuredHome =
    astroHome ||
    environment.ASTRO_HOME ||
    environment.AOT_HOME ||
    path.join(home, ".astrox");
  const resolvedAstroHome = path.resolve(expandHome(configuredHome, home));
  const resolvedPluginDir =
    pluginDir || path.join(resolvedAstroHome, "plugins", "astro");
  return {
    astroHome: resolvedAstroHome,
    configFile: path.join(resolvedPluginDir, "config.yaml"),
    envFile: path.join(resolvedPluginDir, ".env"),
    pluginDir: resolvedPluginDir,
  };
}

function copyTemplateIfMissing(source, destination, mode) {
  if (fs.existsSync(destination)) {
    return false;
  }
  try {
    fs.writeFileSync(destination, fs.readFileSync(source), {
      flag: "wx",
      mode,
    });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function initializeRuntimeConfig({
  environment = process.env,
  templateDir = path.resolve(__dirname, ".."),
  ...pathOptions
} = {}) {
  const paths = resolveRuntimeConfigPaths(environment, pathOptions);
  fs.mkdirSync(paths.pluginDir, { recursive: true });
  return {
    ...paths,
    configCreated: copyTemplateIfMissing(
      path.join(templateDir, "config.example.yaml"),
      paths.configFile,
      0o644,
    ),
    envCreated: copyTemplateIfMissing(
      path.join(templateDir, ".env.example"),
      paths.envFile,
      0o600,
    ),
  };
}

function addDiagnostic(diagnostics, code, file, field, message) {
  diagnostics.push({
    level: "warning",
    code,
    file,
    ...(field ? { field } : {}),
    message,
  });
}

function readLimitedFile(file, diagnostics) {
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const size = fs.statSync(file).size;
    if (size > maxConfigBytes) {
      addDiagnostic(
        diagnostics,
        "CONFIG_TOO_LARGE",
        file,
        "",
        `Configuration file exceeds ${maxConfigBytes} bytes.`,
      );
      return null;
    }
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    addDiagnostic(
      diagnostics,
      "CONFIG_READ_FAILED",
      file,
      "",
      `Configuration file could not be read (${error?.code || "UNKNOWN"}).`,
    );
    return null;
  }
}

function readEnvironmentFile(file, diagnostics) {
  const text = readLimitedFile(file, diagnostics);
  if (text === null) {
    return {};
  }
  try {
    return Object.fromEntries(
      Object.entries(dotenv.parse(text)).filter(([name]) =>
        environmentNamePattern.test(name),
      ),
    );
  } catch {
    addDiagnostic(
      diagnostics,
      "ENV_PARSE_FAILED",
      file,
      "",
      "Environment file could not be parsed.",
    );
    return {};
  }
}

function readYamlFile(file, diagnostics) {
  const text = readLimitedFile(file, diagnostics);
  if (text === null) {
    return {};
  }
  try {
    const value = yaml.parse(text, {
      maxAliasCount: 20,
      prettyErrors: false,
    });
    if (value === null || value === undefined) {
      return {};
    }
    if (!isRecord(value)) {
      throw new TypeError("Configuration root must be a mapping.");
    }
    return value;
  } catch {
    addDiagnostic(
      diagnostics,
      "YAML_PARSE_FAILED",
      file,
      "",
      "YAML configuration could not be parsed.",
    );
    return {};
  }
}

function getPath(value, keys) {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) {
      return { found: false, value: undefined };
    }
    current = current[key];
  }
  return { found: true, value: current };
}

function setPath(value, keys, nextValue) {
  let current = value;
  for (const key of keys.slice(0, -1)) {
    current[key] ||= {};
    current = current[key];
  }
  current[keys.at(-1)] = nextValue;
}

function interpolateString(
  value,
  variables,
  diagnostics,
  file,
  field,
  referencedVariables,
) {
  let unresolved = false;
  const result = value.replace(
    interpolationPattern,
    (_match, name, fallback) => {
      referencedVariables.add(name);
      const variable = variables[name];
      if (variable !== undefined && variable !== "") {
        return String(variable);
      }
      if (fallback !== undefined) {
        return fallback;
      }
      unresolved = true;
      addDiagnostic(
        diagnostics,
        "ENV_VARIABLE_MISSING",
        file,
        field,
        `Required environment variable ${name} is not defined.`,
      );
      return "";
    },
  );
  return unresolved ? undefined : result;
}

function interpolateValue(
  value,
  variables,
  diagnostics,
  file,
  field,
  referencedVariables,
) {
  if (typeof value === "string") {
    return interpolateString(
      value,
      variables,
      diagnostics,
      file,
      field,
      referencedVariables,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      interpolateValue(
        item,
        variables,
        diagnostics,
        file,
        `${field}[${index}]`,
        referencedVariables,
      ),
    );
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        interpolateValue(
          child,
          variables,
          diagnostics,
          file,
          field ? `${field}.${key}` : key,
          referencedVariables,
        ),
      ]),
    );
  }
  return value;
}

function stringValue(value) {
  return typeof value === "string" && value.trim()
    ? { ok: true, value: value.trim() }
    : { ok: false };
}

function nullableStringValue(value) {
  return value === null
    ? { ok: true, value: null }
    : stringValue(value);
}

function integerValue(minimum, maximum = Number.MAX_SAFE_INTEGER) {
  return (value) => {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(number) && number >= minimum && number <= maximum
      ? { ok: true, value: number }
      : { ok: false };
  };
}

function booleanValue(value) {
  if (typeof value === "boolean") {
    return { ok: true, value };
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return { ok: true, value: true };
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return { ok: true, value: false };
  }
  return { ok: false };
}

const fields = [
  {
    path: ["server", "host"],
    environment: "ASTRO_HOST",
    legacy: ["AGENT_TRACE_HOST", "TRAE_TRACE_HOST"],
    defaultValue: "127.0.0.1",
    normalize: stringValue,
  },
  {
    path: ["server", "port"],
    environment: "ASTRO_PORT",
    legacy: ["AGENT_TRACE_PORT", "TRAE_TRACE_PORT"],
    defaultValue: 4318,
    normalize: integerValue(1, 65_535),
  },
  {
    path: ["server", "maxBodyBytes"],
    environment: "ASTRO_MAX_BODY_BYTES",
    legacy: ["AGENT_TRACE_MAX_BODY_BYTES"],
    defaultValue: 5_242_880,
    normalize: integerValue(1),
  },
  {
    path: ["runtime", "autoOpen"],
    environment: "ASTRO_AUTO_OPEN",
    legacy: [],
    defaultValue: true,
    normalize: booleanValue,
  },
  {
    path: ["storage", "traceDir"],
    environment: "ASTRO_TRACE_DIR",
    legacy: ["AGENT_TRACE_DIR", "TRAE_TRACE_DIR"],
    defaultValue: null,
    normalize: nullableStringValue,
  },
  {
    path: ["storage", "projectDir"],
    environment: "ASTRO_PROJECT_DIR",
    legacy: ["AGENT_TRACE_PROJECT_DIR", "TRAE_PROJECT_DIR"],
    defaultValue: null,
    normalize: nullableStringValue,
  },
  {
    path: ["clients", "codex", "home"],
    environment: "CODEX_HOME",
    legacy: [],
    defaultValue: "~/.codex",
    normalize: stringValue,
  },
  {
    path: ["clients", "claude", "home"],
    environment: "CLAUDE_HOME",
    legacy: [],
    defaultValue: "~/.claude",
    normalize: stringValue,
  },
  {
    path: ["clients", "deepseek", "home"],
    environment: "DSH_HOME",
    legacy: [],
    defaultValue: "~/.dsh",
    normalize: stringValue,
  },
  {
    path: ["clients", "deepseek", "command"],
    environment: "DSH_COMMAND",
    legacy: [],
    defaultValue: "dsh",
    normalize: stringValue,
  },
  {
    path: ["clients", "workbuddy", "home"],
    environment: "CODEBUDDY_HOME",
    legacy: [],
    defaultValue: "~/.codebuddy",
    normalize: stringValue,
  },
  {
    path: ["clients", "workbuddy", "command"],
    environment: "CODEBUDDY_COMMAND",
    legacy: [],
    defaultValue: "codebuddy",
    normalize: stringValue,
  },
];

const allowedKeys = new Map([
  ["", new Set(["version", "server", "runtime", "storage", "clients", "integrations"])],
  ["server", new Set(["host", "port", "maxBodyBytes"])],
  ["runtime", new Set(["autoOpen"])],
  ["storage", new Set(["traceDir", "projectDir"])],
  ["clients", new Set(["codex", "claude", "deepseek", "workbuddy"])],
  ["clients.codex", new Set(["home"])],
  ["clients.claude", new Set(["home"])],
  ["clients.deepseek", new Set(["home", "command"])],
  ["clients.workbuddy", new Set(["home", "command"])],
]);

function validateKnownKeys(config, diagnostics, file) {
  for (const [field, keys] of allowedKeys) {
    const selected = field ? getPath(config, field.split(".")) : {
      found: true,
      value: config,
    };
    if (!selected.found || selected.value === null) {
      continue;
    }
    if (!isRecord(selected.value)) {
      addDiagnostic(
        diagnostics,
        "CONFIG_SECTION_INVALID",
        file,
        field,
        "Configuration section must be a mapping.",
      );
      continue;
    }
    for (const key of Object.keys(selected.value)) {
      if (!keys.has(key)) {
        addDiagnostic(
          diagnostics,
          "CONFIG_KEY_UNKNOWN",
          file,
          field ? `${field}.${key}` : key,
          "Unknown configuration key.",
        );
      }
    }
  }
}

function hasValue(value) {
  return value !== undefined && value !== "";
}

function createFieldCandidates({
  definition,
  rawConfig,
  fileEnvironment,
  inheritedEnvironment,
  overrides,
  configFile,
  envFile,
}) {
  const configured = getPath(rawConfig, definition.path);
  return [
    ["cli", overrides[definition.environment], "<command line>"],
    [
      "process",
      inheritedEnvironment[definition.environment],
      "<process environment>",
    ],
    ...definition.legacy.map((name) => [
      "process-legacy",
      inheritedEnvironment[name],
      "<process environment>",
    ]),
    ["env", fileEnvironment[definition.environment], envFile],
    ...definition.legacy.map((name) => [
      "env-legacy",
      fileEnvironment[name],
      envFile,
    ]),
    ["config", configured.found ? configured.value : undefined, configFile],
    ["default", definition.defaultValue, configFile],
  ];
}

function selectFieldValue({
  definition,
  rawConfig,
  fileEnvironment,
  inheritedEnvironment,
  overrides,
  diagnostics,
  configFile,
  envFile,
}) {
  for (const [source, candidate, file] of createFieldCandidates({
    definition,
    rawConfig,
    fileEnvironment,
    inheritedEnvironment,
    overrides,
    configFile,
    envFile,
  })) {
    if (!hasValue(candidate) && candidate !== null) {
      continue;
    }
    const normalized = definition.normalize(candidate);
    if (normalized.ok) {
      if (source.endsWith("-legacy")) {
        addDiagnostic(
          diagnostics,
          "ENV_KEY_DEPRECATED",
          file,
          definition.path.join("."),
          `A deprecated environment alias supplied ${definition.environment}.`,
        );
      }
      return { source, value: normalized.value };
    }
    addDiagnostic(
      diagnostics,
      "CONFIG_VALUE_INVALID",
      file,
      definition.path.join("."),
      "Configured value has an invalid type or range.",
    );
  }
  return { source: "default", value: definition.defaultValue };
}

function serializeEnvironmentValue(value) {
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return value === null ? undefined : String(value);
}

function initializeForLoad(
  paths,
  { environment, initialize, strictInitialization, templateDir },
  diagnostics,
) {
  if (!initialize) {
    return null;
  }
  try {
    return initializeRuntimeConfig({
      environment,
      templateDir,
      pluginDir: paths.pluginDir,
    });
  } catch (error) {
    if (strictInitialization) {
      throw error;
    }
    addDiagnostic(
      diagnostics,
      "CONFIG_INITIALIZATION_FAILED",
      paths.pluginDir,
      "",
      `Plugin configuration could not be initialized (${error?.code || "UNKNOWN"}).`,
    );
    return null;
  }
}

function removeBootstrapEnvironment(fileEnvironment, paths, diagnostics) {
  for (const name of ["ASTRO_HOME", "AOT_HOME"]) {
    if (!Object.hasOwn(fileEnvironment, name)) {
      continue;
    }
    delete fileEnvironment[name];
    addDiagnostic(
      diagnostics,
      "ASTRO_HOME_IGNORED",
      paths.envFile,
      name,
      `${name} must be set before the plugin configuration is loaded.`,
    );
  }
}

function prepareRawConfig(
  paths,
  variables,
  diagnostics,
  referencedVariables,
) {
  let rawConfig = interpolateValue(
    readYamlFile(paths.configFile, diagnostics),
    variables,
    diagnostics,
    paths.configFile,
    "",
    referencedVariables,
  );
  if (!isRecord(rawConfig)) {
    rawConfig = {};
  }
  validateKnownKeys(rawConfig, diagnostics, paths.configFile);
  if (
    Object.hasOwn(rawConfig, "version") &&
    rawConfig.version !== supportedVersion
  ) {
    addDiagnostic(
      diagnostics,
      "CONFIG_VERSION_UNSUPPORTED",
      paths.configFile,
      "version",
      `Only configuration version ${supportedVersion} is supported.`,
    );
    return {};
  }
  if (
    Object.hasOwn(rawConfig, "integrations") &&
    !isRecord(rawConfig.integrations)
  ) {
    addDiagnostic(
      diagnostics,
      "CONFIG_SECTION_INVALID",
      paths.configFile,
      "integrations",
      "Configuration section must be a mapping.",
    );
  }
  return rawConfig;
}

function createResolvedConfig(rawConfig) {
  return {
    version: supportedVersion,
    server: {},
    runtime: {},
    storage: {},
    clients: {
      codex: {},
      claude: {},
      deepseek: {},
      workbuddy: {},
    },
    integrations: isRecord(rawConfig.integrations)
      ? rawConfig.integrations
      : {},
  };
}

function applyConfiguredFields({
  config,
  rawConfig,
  fileEnvironment,
  environment,
  overrides,
  diagnostics,
  paths,
  sources,
}) {
  const effectiveEnvironment = {
    ...environment,
    ASTRO_HOME: paths.astroHome,
  };
  for (const definition of fields) {
    const selected = selectFieldValue({
      definition,
      rawConfig,
      fileEnvironment,
      inheritedEnvironment: environment,
      overrides,
      diagnostics,
      configFile: paths.configFile,
      envFile: paths.envFile,
    });
    setPath(config, definition.path, selected.value);
    sources[definition.environment] = selected.source;
    for (const legacyName of definition.legacy) {
      delete effectiveEnvironment[legacyName];
    }
    const serialized = serializeEnvironmentValue(selected.value);
    if (serialized === undefined) {
      delete effectiveEnvironment[definition.environment];
    } else {
      effectiveEnvironment[definition.environment] = serialized;
    }
  }
  return effectiveEnvironment;
}

function reportUnusedEnvironment(
  fileEnvironment,
  referencedVariables,
  paths,
  diagnostics,
) {
  const supportedNames = new Set(
    fields.flatMap((definition) => [
      definition.environment,
      ...definition.legacy,
    ]),
  );
  for (const name of Object.keys(fileEnvironment)) {
    if (supportedNames.has(name) || referencedVariables.has(name)) {
      continue;
    }
    addDiagnostic(
      diagnostics,
      "ENV_KEY_UNUSED",
      paths.envFile,
      name,
      "Environment key is not referenced by configuration.",
    );
  }
}

function createFileStatus(file, diagnostics, ignoredCodes = []) {
  return {
    exists: fs.existsSync(file),
    path: file,
    valid: !diagnostics.some(
      (item) => item.file === file && !ignoredCodes.includes(item.code),
    ),
  };
}

function createVariableMap(fileEnvironment, environment) {
  return {
    ...fileEnvironment,
    ...Object.fromEntries(
      Object.entries(environment).filter(([, value]) => value !== undefined),
    ),
  };
}

function resolveAstroHomeSource(overrides, environment) {
  if (overrides.ASTRO_HOME !== undefined) {
    return "cli";
  }
  if (environment.ASTRO_HOME !== undefined) {
    return "process";
  }
  return environment.AOT_HOME !== undefined ? "process-legacy" : "default";
}

function createLoadResult({
  config,
  diagnostics,
  effectiveEnvironment,
  initialization,
  paths,
  sources,
}) {
  return {
    config,
    diagnostics,
    environment: effectiveEnvironment,
    files: {
      config: createFileStatus(paths.configFile, diagnostics, [
        "CONFIG_KEY_UNKNOWN",
      ]),
      env: createFileStatus(paths.envFile, diagnostics),
    },
    initialization,
    paths,
    sources,
  };
}

function loadRuntimeConfig(options = {}) {
  const {
    environment = process.env, overrides = {}, initialize = false,
    strictInitialization = false, templateDir, ...pathOptions
  } = options;
  const diagnostics = [];
  const paths = resolveRuntimeConfigPaths(environment, pathOptions);
  const initialization = initializeForLoad(
    paths,
    { environment, initialize, strictInitialization, templateDir },
    diagnostics,
  );
  const fileEnvironment = readEnvironmentFile(paths.envFile, diagnostics);
  removeBootstrapEnvironment(fileEnvironment, paths, diagnostics);
  const referencedVariables = new Set();
  const rawConfig = prepareRawConfig(
    paths,
    createVariableMap(fileEnvironment, environment),
    diagnostics,
    referencedVariables,
  );
  const config = createResolvedConfig(rawConfig);
  const sources = {
    ASTRO_HOME: resolveAstroHomeSource(overrides, environment),
  };
  const effectiveEnvironment = applyConfiguredFields({
    config,
    rawConfig,
    fileEnvironment,
    environment,
    overrides,
    diagnostics,
    paths,
    sources,
  });
  reportUnusedEnvironment(
    fileEnvironment,
    referencedVariables,
    paths,
    diagnostics,
  );
  return createLoadResult({
    config,
    diagnostics,
    effectiveEnvironment,
    initialization,
    paths,
    sources,
  });
}

function formatRuntimeConfigDiagnostic(diagnostic) {
  const field = diagnostic.field ? ` (${diagnostic.field})` : "";
  return `[astro-config] ${diagnostic.file}${field}: ${diagnostic.message}`;
}

module.exports = {
  formatRuntimeConfigDiagnostic,
  initializeRuntimeConfig,
  loadRuntimeConfig,
  resolveRuntimeConfigPaths,
};
