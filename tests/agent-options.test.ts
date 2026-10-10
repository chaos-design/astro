import assert from "node:assert/strict";
import test from "node:test";
import { appDefaults } from "../src/config/app-config.ts";
import { agentOptions, atomPlatformOptions } from "../src/config/atom-platforms.ts";

test("the agent dropdown lists common agents first", () => {
  const ids = agentOptions.map((option) => option.id);
  for (const id of ["claude", "gpt", "gemini", "llama", "pi"]) {
    assert.equal(ids.includes(id), true, `missing agent ${id}`);
  }
  assert.equal(ids[0], "claude");
  assert.equal(new Set(ids).size, ids.length);
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
