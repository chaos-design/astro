import assert from "node:assert/strict";
import test from "node:test";
import {
  readStorageBoolean,
  readStorageValue,
  writeStorageValue,
} from "../src/lib/local-storage.ts";
import { storageKeys } from "../src/config/app-config.ts";

function createStorage(values: Record<string, string> = {}) {
  const entries = new Map(Object.entries(values));
  return {
    entries,
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
  };
}

test("uses ASTROX-prefixed keys for persisted preferences", () => {
  assert.ok(
    Object.values(storageKeys).every((key) => key.startsWith("ASTROX_")),
  );
});

test("reads persisted panel booleans and ignores invalid values", () => {
  const storage = createStorage({
    [storageKeys.consoleOpen]: "false",
    [storageKeys.historyOpen]: "invalid",
  });

  assert.equal(
    readStorageBoolean(storage, storageKeys.consoleOpen, true),
    false,
  );
  assert.equal(
    readStorageBoolean(storage, storageKeys.historyOpen, true),
    true,
  );
});

test("migrates a legacy preference after writing the prefixed key", () => {
  const storage = createStorage({ "astro-theme": "light" });

  assert.equal(
    readStorageValue(
      storage,
      storageKeys.theme,
      "dark",
      "astro-theme",
    ),
    "light",
  );

  writeStorageValue(storage, storageKeys.theme, "light", "astro-theme");
  assert.equal(storage.entries.get(storageKeys.theme), "light");
  assert.equal(storage.entries.has("astro-theme"), false);
});
