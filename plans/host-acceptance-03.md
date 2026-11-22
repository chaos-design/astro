# Host integration equivalence acceptance (plan F3)

Generated: 2026-11-22T06:39:32.229Z

This record covers protocol-level acceptance using captured payloads and real
hook processes. It does **not** replace launching Claude Code or ZCode:
`/hooks` visibility, transcript wording and `hook.run.failed` in a fresh session
still need a host session. The probes and the live-session scan below record
what this machine can and cannot verify; the runbook lists the remaining steps.

| Check | Result | Detail |
| --- | --- | --- |
| captured payload source | pass | /Users/xcz/.astrox/zcode/2026/11-19/23_39_24-sess_4db98348-a34b-4f04-bcd4-775963ab9029/events.jsonl (1 questions) |
| auto-approve hook emits a real-host PermissionRequest decision | pass | 1 answers, keys match question text |
| interaction hook fails open with no host service | pass | empty stdout, exit 0 (host prompt remains) |
| interaction decision matches Claude PreToolUse schema | pass | permissionDecision + updatedInput.answers |
| interaction decision matches ZCode strict PermissionRequest schema | pass | hookSpecificOutput.decision.behavior, strict key set |
| installer generates valid Claude / ZCode / CodeBuddy configurations | pass | claude command / zcode events+enabled / codebuddy PreToolUse modifiedInput |

Summary: 6/6 passed.

## Host availability probe

Machine-generated on every run; this is the evidence behind the F3 blocker.

| Host | Finding | Detail |
| --- | --- | --- |
| claude | config-only | only the config directory exists (recorder hooks or settings); no binary |
| zcode | app | the agent runs only inside the GUI app process; no standalone CLI is shipped, so a real session must be driven by hand (/Applications/ZCode.app/Contents/MacOS/ZCode) |
| codebuddy | app | the agent runs only inside the GUI app process; a real session must be driven by hand (/Applications/AgnesCode.app/Contents/MacOS/AgnesCode) |

## Live ZCode host session (machine-scanned)

Scanned /Users/xcz/.zcode/cli/log/zcode-2026-11-22.jsonl (2026-11-22): **111** hook.run.allowed, **0** hook.run.failed, 111 ASTRO-sourced, last ASTRO call Bash at 2026-11-22T06:19:01.350Z.

A real ZCode host session ran ASTRO hooks on this day with **no `hook.run.failed`** — the F3 ZCode criterion of a clean fresh-session log holds on this machine.

Note: the ASTRO calls logged here come from the installed **recorder** plugin, so this proves the host's hook mechanism is healthy and the day's session is clean. It is **not** the interaction-hook closed loop (registering a question and carrying a human answer back); that still needs the interaction hook installed and an AskUserQuestion triggered inside the host.

## Runbook for the host-equipped machine (F3)

The equivalence checks above pass on any machine. The three remaining F3
items need a real host session; execute them in order and record the
outcome here, then tick F3 in `plans/pending/03-ask-user-question-
implementation-breakdown.md` and archive the plan.

1. Claude `/hooks` visibility and transcript wording
   - `pnpm install:interaction -- --client=claude --apply` (backs up
     `~/.claude/settings.json` first).
   - Start Claude Code in any directory, run `/hooks`, and confirm the
     `interaction-hook.mjs` handler is listed under PermissionRequest.
   - Trigger an AskUserQuestion, answer from the ASTRO console, then check
     the session transcript for `Allowed by PermissionRequest hook`.
2. ZCode fresh-session log
   - `pnpm install:interaction -- --client=zcode --apply` (sets
     `hooks.enabled=true` in `~/.zcode/cli/config.json`).
   - Open a **new** ZCode session (hooks are snapshotted at session start),
     trigger an AskUserQuestion, answer or let the 4.5 s window expire.
   - `grep hook.run.failed ~/.zcode/cli/log/zcode-$(date +%F).jsonl` must
     report no match, and the session log must show the hook ran.
3. Record: paste both evidences into this file under a dated section, tick
   F3, `plan_flow.py --root plans move 03 planing`, complete the remaining
   DoD boxes (`code`, `func_test_result`) and archive.

