const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  formatRuntimeConfigDiagnostic,
  initializeRuntimeConfig,
  loadRuntimeConfig,
  resolveRuntimeConfigPaths,
} = require("../plugin/runtime-config.cjs");

const projectDir = path.resolve(__dirname, "..");

function createFixture(t) {
  const astroHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "astro-runtime-config-"),
  );
  t.after(() => fs.rmSync(astroHome, { recursive: true, force: true }));
  const paths = resolveRuntimeConfigPaths(
    { ASTRO_HOME: astroHome },
    { astroHome },
  );
  return { astroHome, paths };
}

function writeConfiguration(paths, yaml, env = "") {
  fs.mkdirSync(paths.pluginDir, { recursive: true });
  fs.writeFileSync(paths.configFile, yaml, "utf8");
  fs.writeFileSync(paths.envFile, env, "utf8");
}

test("initializes shared plugin configuration from project templates", (t) => {
  const { astroHome, paths } = createFixture(t);
  const result = initializeRuntimeConfig({
    astroHome,
    environment: {},
    templateDir: projectDir,
  });

  assert.equal(result.configCreated, true);
  assert.equal(result.envCreated, true);
  assert.equal(fs.existsSync(path.join(astroHome, "config.yaml")), false);
  assert.equal(fs.existsSync(path.join(astroHome, ".env")), false);
  assert.equal(
    fs.readFileSync(paths.configFile, "utf8"),
    fs.readFileSync(path.join(projectDir, "config.example.yaml"), "utf8"),
  );
  assert.equal(
    fs.readFileSync(paths.envFile, "utf8"),
    fs.readFileSync(path.join(projectDir, ".env.example"), "utf8"),
  );
  assert.equal(fs.statSync(paths.envFile).mode & 0o777, 0o600);
});

test("preserves active files when configuration is initialized again", (t) => {
  const { astroHome, paths } = createFixture(t);
  initializeRuntimeConfig({
    astroHome,
    environment: {},
    templateDir: projectDir,
  });
  fs.writeFileSync(paths.configFile, "version: 1\nserver:\n  port: 4400\n");
  fs.writeFileSync(paths.envFile, "PRIVATE_TOKEN=kept\n");

  const result = initializeRuntimeConfig({
    astroHome,
    environment: {},
    templateDir: projectDir,
  });

  assert.equal(result.configCreated, false);
  assert.equal(result.envCreated, false);
  assert.match(fs.readFileSync(paths.configFile, "utf8"), /port: 4400/);
  assert.equal(fs.readFileSync(paths.envFile, "utf8"), "PRIVATE_TOKEN=kept\n");
});

test("loads YAML, interpolates private values, and applies precedence", (t) => {
  const { astroHome, paths } = createFixture(t);
  writeConfiguration(
    paths,
    [
      "version: 1",
      "server:",
      "  host: ${LOCAL_HOST:-127.0.0.1}",
      "  port: 4400",
      "runtime:",
      "  autoOpen: false",
      "integrations:",
      "  example:",
      "    apiKey: ${EXAMPLE_API_KEY}",
      "",
    ].join("\n"),
    [
      "export LOCAL_HOST='localhost'",
      "EXAMPLE_API_KEY=file-secret",
      "ASTRO_PORT=4500",
      "",
    ].join("\n"),
  );

  const result = loadRuntimeConfig({
    astroHome,
    environment: { ASTRO_HOME: astroHome, ASTRO_PORT: "4600" },
    overrides: { ASTRO_PORT: "4700" },
  });

  assert.equal(result.config.server.host, "localhost");
  assert.equal(result.config.server.port, 4700);
  assert.equal(result.config.runtime.autoOpen, false);
  assert.equal(
    result.config.integrations.example.apiKey,
    "file-secret",
  );
  assert.equal(result.environment.ASTRO_PORT, "4700");
  assert.equal(result.environment.EXAMPLE_API_KEY, undefined);
  assert.equal(result.sources.ASTRO_PORT, "cli");
  assert.equal(result.diagnostics.length, 0);
});

test("uses process variables before file values during interpolation", (t) => {
  const { astroHome, paths } = createFixture(t);
  writeConfiguration(
    paths,
    [
      "version: 1",
      "integrations:",
      "  example:",
      "    apiKey: ${EXAMPLE_API_KEY}",
      "    endpoint: ${API_ENDPOINT:-https://localhost}",
      "",
    ].join("\n"),
    "EXAMPLE_API_KEY=file-secret\n",
  );

  const result = loadRuntimeConfig({
    astroHome,
    environment: {
      ASTRO_HOME: astroHome,
      EXAMPLE_API_KEY: "process-secret",
    },
  });

  assert.equal(
    result.config.integrations.example.apiKey,
    "process-secret",
  );
  assert.equal(
    result.config.integrations.example.endpoint,
    "https://localhost",
  );
});

test("ignores invalid values and reports names without secret values", (t) => {
  const { astroHome, paths } = createFixture(t);
  writeConfiguration(
    paths,
    [
      "version: 1",
      "server:",
      "  port: invalid",
      "  typo: true",
      "integrations:",
      "  example:",
      "    apiKey: ${MISSING_API_KEY}",
      "",
    ].join("\n"),
    [
      "ASTRO_HOME=/ignored",
      "UNUSED_SECRET=must-not-appear",
      "",
    ].join("\n"),
  );

  const result = loadRuntimeConfig({
    astroHome,
    environment: { ASTRO_HOME: astroHome },
  });
  const diagnostics = JSON.stringify(result.diagnostics);

  assert.equal(result.config.server.port, 4318);
  assert.equal(result.paths.astroHome, astroHome);
  assert.match(diagnostics, /CONFIG_KEY_UNKNOWN/);
  assert.match(diagnostics, /CONFIG_VALUE_INVALID/);
  assert.match(diagnostics, /ENV_VARIABLE_MISSING/);
  assert.match(diagnostics, /ASTRO_HOME_IGNORED/);
  assert.match(diagnostics, /ENV_KEY_UNUSED/);
  assert.doesNotMatch(diagnostics, /must-not-appear/);
  assert.doesNotMatch(
    formatRuntimeConfigDiagnostic(result.diagnostics.at(-1)),
    /must-not-appear/,
  );
});

test("falls back safely when YAML is malformed", (t) => {
  const { astroHome, paths } = createFixture(t);
  writeConfiguration(paths, "version: [\n", "");

  const result = loadRuntimeConfig({
    astroHome,
    environment: { ASTRO_HOME: astroHome },
  });

  assert.equal(result.config.server.port, 4318);
  assert.equal(result.files.config.valid, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "YAML_PARSE_FAILED",
    ),
  );
});

test("fails installation when required source templates are missing", (t) => {
  const { astroHome } = createFixture(t);

  assert.throws(
    () =>
      initializeRuntimeConfig({
        astroHome,
        environment: {},
        templateDir: path.join(astroHome, "missing-templates"),
      }),
    (error) => error?.code === "ENOENT",
  );
});
