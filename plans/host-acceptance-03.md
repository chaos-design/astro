# Host integration equivalence acceptance (plan F3)

Generated: 2026-11-16T03:28:09.931Z

This record covers protocol-level acceptance using captured payloads and real
hook processes. It does **not** replace launching Claude Code or ZCode:
`/hooks` visibility, transcript wording and `hook.run.failed` in a fresh session
remain unverified on this machine because no host binary is installed.

| Check | Result | Detail |
| --- | --- | --- |
| captured payload source | pass | /Users/xcz/.astrox/zcode/2026/11-15/20_12_53-sess_e368bd57-f885-4f11-b215-e2e8b8693cf6/events.jsonl (3 questions) |
| auto-approve hook emits a real-host PermissionRequest decision | pass | 3 answers, keys match question text |
| interaction hook fails open with no host service | pass | empty stdout, exit 0 (host prompt remains) |
| interaction decision matches Claude PreToolUse schema | pass | permissionDecision + updatedInput.answers |
| interaction decision matches ZCode strict PermissionRequest schema | pass | hookSpecificOutput.decision.behavior, strict key set |
| installer generates valid Claude / ZCode / CodeBuddy configurations | pass | claude command / zcode events+enabled / codebuddy PreToolUse modifiedInput |

Summary: 6/6 passed.

## Addendum 2026-11-16: host binary availability re-check

Re-verified what "no host binary" means on this machine before asking for a
host-equipped environment:

- Claude Code: still absent. No `claude` executable in PATH, login shell,
  Homebrew, `/usr/local/bin`, `~/.local/bin`, npm/pnpm globals, or inside
  `/Applications/ZCode.app` / `AgnesCode.app` / `WorkBuddy.app`.
- ZCode: `/Applications/ZCode.app` exists and its CLI is actively used
  (`~/.zcode/cli/log/zcode-<date>.jsonl` written daily; hooks config absent from
  `~/.zcode/cli/config.json`). The CLI entry lives inside the app bundle
  (`app.asar` exports `/cli.js` and `/cli-daemon/program.js`), but the host
  cannot be driven headlessly from a non-interactive sandbox: invoking the
  Electron binary with the asar loads the GUI main entry (`BrowserWindow`
  required), and the binary disables Node environment variables when it is
  spawned by another process, so neither `ELECTRON_RUN_AS_NODE` nor a
  redirected home can isolate a session. Real F3 acceptance therefore still
  needs a manually driven ZCode session.
- CodeBuddy: the running host itself has recorder hooks in
  `~/.codebuddy/settings.json` (`--source=workbuddy`), but CodeBuddy is not a
  target of F3.
