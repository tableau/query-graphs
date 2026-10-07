import assert from "node:assert/strict";
import test from "node:test";
import {createSettingsStore} from "../src/ui/settings";

const storageKey = "query-graphs-settings";

function memoryStorage(initialValue?: string) {
    const values = new Map<string, string>();
    if (initialValue !== undefined) values.set(storageKey, initialValue);
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    };
}

function withBrowserStorage<T>(
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    run: (notify: (key: string | null) => void) => T,
): T {
    const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    let storageListener: ((event: StorageEvent) => void) | undefined;
    Object.defineProperty(globalThis, "localStorage", {configurable: true, value: storage});
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
                if (type === "storage") storageListener = listener;
            },
        },
    });
    try {
        return run((key) => storageListener?.({key, storageArea: storage} as unknown as StorageEvent));
    } finally {
        if (previousLocalStorage === undefined) Reflect.deleteProperty(globalThis, "localStorage");
        else Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
        if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
        else Object.defineProperty(globalThis, "window", previousWindow);
    }
}

test("settings load recognized properties and ignore unknown properties", () => {
    const valid = memoryStorage(JSON.stringify({animationSpeed: "slow", futureSetting: true}));
    withBrowserStorage(valid, () => assert.equal(createSettingsStore().getState().values.animationSpeed, "slow"));

    for (const invalid of ["not JSON", JSON.stringify({futureSetting: true}), JSON.stringify({animationSpeed: "no-such-speed"})]) {
        const storage = memoryStorage(invalid);
        withBrowserStorage(storage, () => assert.equal(createSettingsStore().getState().values.animationSpeed, "medium"));
    }
});

test("settings updates persist and reset to defaults", () => {
    const storage = memoryStorage();
    withBrowserStorage(storage, () => {
        const store = createSettingsStore();
        let updates = 0;
        const unsubscribe = store.subscribe(() => updates++);

        store.getState().setSettings({animationSpeed: "debug"});
        assert.equal(store.getState().values.animationSpeed, "debug");
        assert.deepEqual(JSON.parse(storage.getItem(storageKey)!), {animationSpeed: "debug"});

        store.getState().resetSettings();
        assert.equal(store.getState().values.animationSpeed, "medium");
        assert.equal(storage.getItem(storageKey), null);
        assert.equal(updates, 2);
        unsubscribe();
    });
});

test("settings follow updates and resets from other tabs", () => {
    const storage = memoryStorage();
    withBrowserStorage(storage, (notify) => {
        const store = createSettingsStore();

        storage.setItem(storageKey, JSON.stringify({animationSpeed: "slow", futureSetting: true}));
        notify(storageKey);
        assert.equal(store.getState().values.animationSpeed, "slow");

        storage.removeItem(storageKey);
        notify(storageKey);
        assert.equal(store.getState().values.animationSpeed, "medium");
    });
});

test("settings remain usable when storage is unavailable", () => {
    const unavailableStorage = {
        getItem: () => {
            throw new Error("unavailable");
        },
        setItem: () => {
            throw new Error("unavailable");
        },
        removeItem: () => {
            throw new Error("unavailable");
        },
    };
    withBrowserStorage(unavailableStorage, () => {
        const store = createSettingsStore();

        assert.equal(store.getState().values.animationSpeed, "medium");
        store.getState().setSettings({animationSpeed: "fast"});
        assert.equal(store.getState().values.animationSpeed, "fast");
        store.getState().resetSettings();
        assert.equal(store.getState().values.animationSpeed, "medium");
    });
});
