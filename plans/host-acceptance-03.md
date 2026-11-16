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
