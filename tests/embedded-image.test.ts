import assert from "node:assert/strict";
import test from "node:test";
import { findDataImages, replaceDataImages } from "../src/lib/embedded-image.ts";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

test("finds distinct inline images inside a captured JSON string", () => {
  const raw = JSON.stringify({
    type: "image_url",
    image_url: { url: PNG },
    duplicate: PNG,
  });
  assert.deepEqual(findDataImages(raw), [PNG]);
});

test("ignores non-image data URLs and disallowed image types", () => {
  assert.deepEqual(findDataImages("data:text/plain;base64,YQ=="), []);
  assert.deepEqual(findDataImages("data:image/tiff;base64,YQ=="), []);
});

test("replaces raw base64 with a short label without touching the rest", () => {
  const replaced = replaceDataImages(`prefix ${PNG} suffix`);
  assert.equal(replaced, "prefix [内嵌图片] suffix");
  assert.doesNotMatch(replaced, /base64/);
});
