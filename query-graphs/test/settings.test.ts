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

test("settings load recognized properties and ignore unknown properties", () => {
    const valid = memoryStorage(JSON.stringify({animationSpeed: "slow", futureSetting: true}));
    assert.equal(createSettingsStore(valid).getState().values.animationSpeed, "slow");

    for (const invalid of ["not JSON", JSON.stringify({futureSetting: true}), JSON.stringify({animationSpeed: "instant"})]) {
        assert.equal(createSettingsStore(memoryStorage(invalid)).getState().values.animationSpeed, "medium");
    }
});

test("settings updates persist and reset to defaults", () => {
    const storage = memoryStorage();
    const store = createSettingsStore(storage);
    let updates = 0;
    const unsubscribe = store.subscribe(() => updates++);

    store.getState().setAnimationSpeed("excruciating");
    assert.equal(store.getState().values.animationSpeed, "excruciating");
    assert.deepEqual(JSON.parse(storage.getItem(storageKey)!), {animationSpeed: "excruciating"});

    store.getState().resetSettings();
    assert.equal(store.getState().values.animationSpeed, "medium");
    assert.equal(storage.getItem(storageKey), null);
    assert.equal(updates, 2);
    unsubscribe();
});

test("settings follow updates and resets from other tabs", () => {
    const storage = memoryStorage();
    let reloadSettings = () => assert.fail("storage subscription not initialized");
    const store = createSettingsStore(storage, (_storage, onChange) => {
        reloadSettings = onChange;
    });

    storage.setItem(storageKey, JSON.stringify({animationSpeed: "slow", futureSetting: true}));
    reloadSettings();
    assert.equal(store.getState().values.animationSpeed, "slow");

    storage.removeItem(storageKey);
    reloadSettings();
    assert.equal(store.getState().values.animationSpeed, "medium");
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
    const store = createSettingsStore(unavailableStorage);

    assert.equal(store.getState().values.animationSpeed, "medium");
    store.getState().setAnimationSpeed("fast");
    assert.equal(store.getState().values.animationSpeed, "fast");
    store.getState().resetSettings();
    assert.equal(store.getState().values.animationSpeed, "medium");
});
