import {useStore} from "zustand";
import {createStore} from "zustand/vanilla";
import type {StoreApi} from "zustand/vanilla";

export const animationSpeedOptions = [
    {value: "off", label: "Off", duration: undefined},
    {value: "fast", label: "Fast", duration: 100},
    {value: "medium", label: "Medium", duration: 200},
    {value: "slow", label: "Slow", duration: 500},
    {value: "debug", label: "Debug", duration: 5000},
] as const;

export type AnimationSpeed = (typeof animationSpeedOptions)[number]["value"];

export interface SettingsValues {
    animationSpeed: AnimationSpeed;
}

/** Preferences shared by the graph and host-application features. */
export interface ApplicationSettingsState {
    values: SettingsValues;
    setSettings: (settings: Partial<SettingsValues>) => void;
    resetSettings: () => void;
}

const defaultSettings: SettingsValues = {animationSpeed: "medium"};
const settingsStorageKey = "query-graphs-settings";

function settingsFromJson(serialized: string | null | undefined): SettingsValues {
    if (serialized === undefined || serialized === null) return defaultSettings;
    let rawSettings: unknown;
    try {
        rawSettings = JSON.parse(serialized);
    } catch {
        // Malformed settings should not prevent the graph from rendering.
        return defaultSettings;
    }
    const settings = {...defaultSettings};
    if (typeof rawSettings !== "object" || rawSettings === null) return settings;
    if ("animationSpeed" in rawSettings && animationSpeedOptions.some(({value}) => value === rawSettings.animationSpeed))
        settings.animationSpeed = rawSettings.animationSpeed as AnimationSpeed;
    return settings;
}

export function createSettingsStore(): StoreApi<ApplicationSettingsState> {
    function loadSettings(): SettingsValues {
        try {
            return settingsFromJson(localStorage.getItem(settingsStorageKey));
        } catch {
            return defaultSettings;
        }
    }

    const store = createStore<ApplicationSettingsState>()((set) => ({
        values: loadSettings(),
        setSettings: (settings) =>
            set((state) => {
                const values = {...state.values, ...settings};
                try {
                    localStorage.setItem(settingsStorageKey, JSON.stringify(values));
                } catch {
                    // Keep the in-memory preference when storage is unavailable.
                }
                return {values};
            }),
        resetSettings: () => {
            try {
                localStorage.removeItem(settingsStorageKey);
            } catch {
                // Keep resetting the in-memory preference when storage is unavailable.
            }
            set({values: defaultSettings});
        },
    }));
    if (typeof window !== "undefined")
        window.addEventListener("storage", (event) => {
            if (event.storageArea === localStorage && (event.key === settingsStorageKey || event.key === null))
                store.setState({values: loadSettings()});
        });
    return store;
}

export const settingsStore = createSettingsStore();

export function useSettings<T>(selector: (settings: ApplicationSettingsState) => T): T {
    return useStore(settingsStore, selector);
}
