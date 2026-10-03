type StorageAccess = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function readStorageValue(
  storage: StorageAccess,
  key: string,
  fallback: string,
  legacyKey?: string,
) {
  try {
    return storage.getItem(key) ?? (
      legacyKey ? storage.getItem(legacyKey) : null
    ) ?? fallback;
  } catch {
    return fallback;
  }
}

export function readStorageBoolean(
  storage: StorageAccess,
  key: string,
  fallback: boolean,
) {
  const value = readStorageValue(storage, key, String(fallback));
  return value === "true" ? true : value === "false" ? false : fallback;
}

export function writeStorageValue(
  storage: StorageAccess,
  key: string,
  value: string | boolean,
  legacyKey?: string,
) {
  try {
    storage.setItem(key, String(value));
    if (legacyKey) {
      storage.removeItem(legacyKey);
    }
  } catch {
    // Preferences remain usable for the current page when storage is unavailable.
  }
}
