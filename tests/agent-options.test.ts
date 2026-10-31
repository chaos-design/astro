import assert from "node:assert/strict";
import test from "node:test";
import { appDefaults } from "../src/config/app-config.ts";
import { agentOptions, atomPlatformOptions } from "../src/config/atom-platforms.ts";

test("the agent dropdown pins high-frequency agents, then sorts the rest", () => {
  const ids = agentOptions.map((option) => option.id);
  const labels = agentOptions.map((option) => option.label);
  // The agents switched between most often keep this exact order.
  assert.deepEqual(ids.slice(0, 9), [
    "claude",
    "codex",
    "deepseek",
    "workbuddy",
    "zcode",
    "opencode",
    "pi",
    "qwen",
    "trae",
  ]);
  // GPT has no capture adapter of its own; Codex covers the OpenAI runtime.
  assert.equal((ids as string[]).includes("gpt"), false);
  assert.equal(ids[0], "claude");
  assert.equal(new Set(ids).size, ids.length);
  // Every remaining agent follows alphabetically by label.
  const tail = labels.slice(9);
  assert.deepEqual(tail, [...tail].sort((a, b) => a.localeCompare(b, "en")));
  assert.equal(ids.length, atomPlatformOptions.length);
});

test("the default agent is the first dropdown option", () => {
  assert.equal(appDefaults.platform, agentOptions[0].id);
});

test("every dropdown agent is also a configured platform", () => {
  const configured = new Set(atomPlatformOptions.map((option) => option.id));
  for (const option of agentOptions) {
    assert.equal(configured.has(option.id), true, `unconfigured ${option.id}`);
    assert.equal(option.source.length > 0, true);
  }
});
