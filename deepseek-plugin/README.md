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

The equivalent native command is (point it at the **installed** copy, whose
generated `cordis.patch.yml` carries `config.astroHome`; the source checkout's
patch does not):

```sh
dsh plugin --profile web add file:/absolute/path/to/astro-home/plugins/astro/deepseek-plugin
```

Restart the profile after installation:

```sh
dsh web
```

If your harness runs from a local source checkout (`pnpm start:web` inside
`deepseek-harness`), `dsh` is not on PATH and the installer's `npx` fallback is
the published build, not that checkout. Set `DSH_COMMAND` (or pass
`--deepseek-command`) to a wrapper such as:

```sh
#!/bin/sh
exec node --import tsx/esm /path/to/deepseek-harness/apps/cli/src/bin.ts "$@"
```

Make sure the profile and home match the running service
(`--deepseek-profile`, `--dsh-home`). The installer fails if the add command
does not leave `dsh-astro-plugin` in both `dependencies` and
`dsh.profile.bundles` of the profile manifest — a zero exit code alone is not
proof that dsh mounted the layer.

Verify the integration:

```sh
node bin/astro.mjs doctor --deepseek-profile=web
dsh --profile web --dump-config | grep -A3 "dsh-astro-plugin"
```

The dump must show a `# == dsh-astro-plugin` layer with an `astro-trace` entry.
If no events appear after restarting, check
`$DSH_HOME/logs/startup-*.log` for `astro-trace` and any `pending` / `failed`
entry.

Remove it with:

```sh
dsh plugin --profile web remove dsh-astro-plugin
```
