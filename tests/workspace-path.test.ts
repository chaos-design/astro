import assert from "node:assert/strict";
import test from "node:test";
import {
  describeWorkspacePath,
  workspacePathLeaf,
} from "../src/lib/workspace-path.ts";

test("renders the home directory itself as ~", () => {
  assert.deepEqual(describeWorkspacePath("/Users/xcz"), {
    full: "~",
    kind: "directory",
    name: "~",
  });
  assert.deepEqual(describeWorkspacePath("/home/xcz"), {
    full: "~",
    kind: "directory",
    name: "~",
  });
  assert.deepEqual(describeWorkspacePath("/root"), {
    full: "~",
    kind: "directory",
    name: "~",
  });
  assert.deepEqual(describeWorkspacePath("/root/"), {
    full: "~",
    kind: "directory",
    name: "~",
  });
});

test("nested paths under home keep only the last segment as the label", () => {
  assert.deepEqual(describeWorkspacePath("/Users/xcz/Desktop/a/b/c"), {
    full: "~/Desktop/a/b/c",
    kind: "directory",
    name: "c",
  });
  assert.deepEqual(describeWorkspacePath("/home/xcz/work/site/"), {
    full: "~/work/site",
    kind: "directory",
    name: "site",
  });
});

test("labels an already ~-relative path without re-prefixing it", () => {
  assert.deepEqual(describeWorkspacePath("~/xxx/yyy/zzz"), {
    full: "~/xxx/yyy/zzz",
    kind: "directory",
    name: "zzz",
  });
  assert.deepEqual(describeWorkspacePath("~"), {
    full: "~",
    kind: "directory",
    name: "~",
  });
});

test("keeps paths outside the home directory absolute", () => {
  assert.deepEqual(describeWorkspacePath("/tmp/build/output"), {
    full: "/tmp/build/output",
    kind: "directory",
    name: "output",
  });
  assert.deepEqual(describeWorkspacePath("/Volumes/work/demo"), {
    full: "/Volumes/work/demo",
    kind: "directory",
    name: "demo",
  });
});

test("marks a file target as a file", () => {
  assert.deepEqual(describeWorkspacePath("/Users/xcz/proj/src/app.tsx"), {
    full: "~/proj/src/app.tsx",
    kind: "file",
    name: "app.tsx",
  });
  // A dot-directory is a directory, not a file.
  assert.equal(describeWorkspacePath("/Users/xcz/proj/.github").kind, "directory");
  assert.equal(describeWorkspacePath("/Users/xcz/proj/v0.0.2").kind, "file");
});

test("handles Windows paths", () => {
  assert.deepEqual(describeWorkspacePath("C:\\Users\\xcz\\work\\app"), {
    full: "~\\work\\app",
    kind: "directory",
    name: "app",
  });
  assert.deepEqual(describeWorkspacePath("C:\\Users\\xcz"), {
    full: "~",
    kind: "directory",
    name: "~",
  });
});

test("an unreported workspace resolves to the error kind", () => {
  const expected = { full: "", kind: "error", name: "unknown" };
  assert.deepEqual(describeWorkspacePath(null), expected);
  assert.deepEqual(describeWorkspacePath(undefined), expected);
  assert.deepEqual(describeWorkspacePath(""), expected);
  assert.deepEqual(describeWorkspacePath("   "), expected);
});

test("filesystem root stays itself", () => {
  assert.deepEqual(describeWorkspacePath("/"), {
    full: "/",
    kind: "directory",
    name: "/",
  });
});

test("workspacePathLeaf ignores trailing separators", () => {
  assert.equal(workspacePathLeaf("/Users/xcz/a/b/"), "b");
  assert.equal(workspacePathLeaf("/"), "/");
  assert.equal(workspacePathLeaf("C:\\Users\\xcz\\app"), "app");
});
