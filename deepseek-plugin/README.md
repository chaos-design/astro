# ASTRO for DeepSeek Harness

This DeepSeek Harness bundle records local session lifecycle, prompt, model,
tool, and completion events under:

```text
~/.astrox/deepseek/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

Build the self-contained plugin from the ASTRO repository:

```sh
pnpm install
pnpm build
pnpm build:native-plugins
```

Install it into the standard DeepSeek Harness Web profile:

```sh
pnpm install-plugins -- --clients=deepseek --deepseek-profile=web
```

Installation creates the shared plugin configuration automatically:

```text
~/.astrox/plugins/astro/config.yaml
~/.astrox/plugins/astro/.env
```

Edit `config.yaml` for normal settings. Put local or sensitive values in
`.env`, then reference them from YAML with `${NAME}` or
`${NAME:-fallback}`. Restart the DeepSeek Harness profile after editing either
file.

The equivalent native command is:

```sh
dsh plugin --profile web add file:/absolute/path/to/deepseek-plugin
```

Restart the profile after installation:

```sh
dsh web
```

Verify the integration:

```sh
node bin/astro.mjs doctor --deepseek-profile=web
```

Remove it with:

```sh
dsh plugin --profile web remove dsh-astro-plugin
```
