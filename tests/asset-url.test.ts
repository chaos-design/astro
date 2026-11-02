import assert from "node:assert/strict";
import test from "node:test";

import { assetUrl } from "../src/lib/asset-url.ts";

test("a root base keeps the public path absolute", () => {
  assert.equal(assetUrl("icons/deepseek.svg", "/"), "/icons/deepseek.svg");
  assert.equal(assetUrl("/icons/deepseek.svg", "/"), "/icons/deepseek.svg");
});

test("the relative build base stays relative to the page", () => {
  assert.equal(
    assetUrl("icons/workbuddy-logo.png", "./"),
    "./icons/workbuddy-logo.png",
  );
  assert.equal(assetUrl("icons/deepseek.svg", ""), "/icons/deepseek.svg");
});

test("an absolute sub-path base keeps the project prefix", () => {
  assert.equal(
    assetUrl("icons/deepseek.svg", "/astro/"),
    "/astro/icons/deepseek.svg",
  );
  assert.equal(
    assetUrl("icons/deepseek.svg", "/console"),
    "/console/icons/deepseek.svg",
  );
});

test("a leading slash is normalized instead of duplicated", () => {
  assert.equal(assetUrl("/icons/deepseek.svg", "./"), "./icons/deepseek.svg");
  assert.equal(assetUrl("///icons/x.svg", "/astro/"), "/astro/icons/x.svg");
});
