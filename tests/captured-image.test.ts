import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURED_IMAGE_MIME_TYPES,
  classifyCapturedResource,
  resolveCapturedImage,
} from "../src/lib/captured-image.ts";

const API = "http://127.0.0.1:5678";

test("an inline data URL is an image only when its MIME is whitelisted", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  assert.deepEqual(classifyCapturedResource(png, API), {
    kind: "image",
    origin: "data",
    src: png,
    name: "",
    mime: "image/png",
  });
  assert.equal(
    classifyCapturedResource("data:image/tiff;base64,YQ==", API).kind,
    "text",
  );
  assert.equal(
    classifyCapturedResource("data:image/svg+xml;base64,PHN2Zz4=", API).kind,
    "image",
    "svg is the same whitelist entry on every surface",
  );
  assert.ok(CAPTURED_IMAGE_MIME_TYPES.has("webp"));
});

test("a remote URL is typed by its extension, never by its credentials", () => {
  const image = classifyCapturedResource("https://host/a/shot.PNG?v=2", API);
  assert.equal(image.kind, "image");
  assert.equal(image.origin, "remote");
  const file = classifyCapturedResource("https://host/a/report.pdf", API);
  assert.deepEqual(file, {
    kind: "file",
    path: "https://host/a/report.pdf",
    name: "report.pdf",
    mime: "",
  });
  assert.equal(
    classifyCapturedResource("https://user:pass@host/a.png", API).kind,
    "text",
    "a credential URL is never a preview source",
  );
});

test("a local path is an image or an attachment, not an untyped string", () => {
  const image = resolveCapturedImage("/tmp/capture.png", API);
  assert.equal(image?.origin, "local");
  assert.equal(image?.src, `${API}/api/file?path=%2Ftmp%2Fcapture.png`);
  assert.deepEqual(classifyCapturedResource("/tmp/notes.pdf", API), {
    kind: "file",
    path: "/tmp/notes.pdf",
    name: "notes.pdf",
    mime: "",
  });
  assert.equal(classifyCapturedResource("/tmp/no-extension", API).kind, "text");
});

test("a typed record is classified by its path field", () => {
  assert.equal(
    classifyCapturedResource({ type: "image", file: "/tmp/a.jpg" }, API).kind,
    "image",
  );
  assert.equal(
    classifyCapturedResource({ type: "file", file: "/tmp/a.pdf" }, API).kind,
    "file",
  );
});

test("a Read result with text stays content even though it names a file", () => {
  // Classifying it as an attachment would hide the file's actual text.
  assert.equal(
    classifyCapturedResource(
      { file_path: "/src/index.ts", content: "export const x = 1;" },
      API,
    ).kind,
    "text",
  );
});
