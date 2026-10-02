import {useStore} from "zustand";
import {createStore} from "zustand/vanilla";
import type {StoreApi} from "zustand/vanilla";

export const animationSpeedOptions = [
    {value: "off", label: "Off"},
    {value: "fast", label: "Fast"},
    {value: "medium", label: "Medium"},
    {value: "slow", label: "Slow"},
    {value: "excruciating", label: "Excruciatingly slow"},
] as const;

export type AnimationSpeed = (typeof animationSpeedOptions)[number]["value"];

export interface SettingsValues {
    animationSpeed: AnimationSpeed;
}

/** Preferences shared by the graph and host-application features. */
export interface ApplicationSettingsState {
    values: SettingsValues;
    setAnimationSpeed: (animationSpeed: AnimationSpeed) => void;
    resetSettings: () => void;
}

type SettingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SubscribeToSettingsStorage = (storage: SettingsStorage | undefined, onChange: () => void) => void;

const defaultSettings: SettingsValues = {animationSpeed: "medium"};
const settingsStorageKey = "query-graphs-settings";

function availableStorage(): SettingsStorage | undefined {
    try {
        return typeof window === "undefined" ? undefined : window.localStorage;
    } catch {
        return undefined;
    }
}

function settingsFromJson(serialized: string | null | undefined): SettingsValues {
    try {
        if (serialized === undefined || serialized === null) return defaultSettings;
        const settings: unknown = JSON.parse(serialized);
        if (typeof settings === "object" && settings !== null && "animationSpeed" in settings) {
            const animationSpeed = settings.animationSpeed;
            if (animationSpeedOptions.some(({value}) => value === animationSpeed))
                return {animationSpeed: animationSpeed as AnimationSpeed};
        }
    } catch {
        // Malformed settings should not prevent the graph from rendering.
    }
    return defaultSettings;
}

function loadSettings(storage: SettingsStorage | undefined): SettingsValues {
    try {
        return settingsFromJson(storage?.getItem(settingsStorageKey));
    } catch {
        return defaultSettings;
    }
}

function subscribeToBrowserStorage(storage: SettingsStorage | undefined, onChange: () => void): void {
    if (typeof window === "undefined") return;
    window.addEventListener("storage", (event) => {
        if (event.storageArea === storage && (event.key === settingsStorageKey || event.key === null)) onChange();
    });
}

function saveSettings(storage: SettingsStorage | undefined, values: SettingsValues): void {
    try {
        storage?.setItem(settingsStorageKey, JSON.stringify(values));
    } catch {
        // Keep the in-memory preference when storage is unavailable.
    }
}

export function createSettingsStore(
    storage = availableStorage(),
    subscribeToStorage: SubscribeToSettingsStorage = subscribeToBrowserStorage,
): StoreApi<ApplicationSettingsState> {
    const store = createStore<ApplicationSettingsState>()((set) => ({
        values: loadSettings(storage),
        setAnimationSpeed: (animationSpeed) =>
            set((state) => {
                const values = {...state.values, animationSpeed};
                saveSettings(storage, values);
                return {values};
            }),
        resetSettings: () => {
            try {
                storage?.removeItem(settingsStorageKey);
            } catch {
                // Keep resetting the in-memory preference when storage is unavailable.
            }
            set({values: defaultSettings});
        },
    }));
    subscribeToStorage(storage, () => store.setState({values: loadSettings(storage)}));
    return store;
}

export const settingsStore = createSettingsStore();

export function useSettings<T>(selector: (settings: ApplicationSettingsState) => T): T {
    return useStore(settingsStore, selector);
}
