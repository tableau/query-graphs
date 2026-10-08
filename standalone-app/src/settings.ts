import {animationSpeedOptions} from "@tableau/query-graphs/lib/ui/animation-timing";
import type {AnimationSpeed} from "@tableau/query-graphs/lib/ui/animation-timing";
import {useStore} from "zustand";
import {createStore} from "zustand/vanilla";
import type {StoreApi} from "zustand/vanilla";

export const themeOptions = [
    {value: "system", label: "System"},
    {value: "light", label: "Light"},
    {value: "dark", label: "Dark"},
] as const;

export type Theme = (typeof themeOptions)[number]["value"];

export const editorKeybindingsOptions = [
    {value: "standard", label: "Standard"},
    {value: "vim", label: "Vim"},
    {value: "emacs", label: "Emacs"},
] as const;

export type EditorKeybindings = (typeof editorKeybindingsOptions)[number]["value"];

export interface SettingsValues {
    animationSpeed: AnimationSpeed;
    theme: Theme;
    editorKeybindings: EditorKeybindings;
}

export interface ApplicationSettingsState {
    values: SettingsValues;
    setSettings: (settings: Partial<SettingsValues>) => void;
    resetSettings: () => void;
}

const defaultSettings: SettingsValues = {animationSpeed: "medium", theme: "system", editorKeybindings: "standard"};
const settingsStorageKey = "query-graphs-settings";

function settingsFromJson(serialized: string | null | undefined): SettingsValues {
    if (serialized === undefined || serialized === null) return defaultSettings;
    let rawSettings: unknown;
    try {
        rawSettings = JSON.parse(serialized);
    } catch {
        // Malformed settings should not prevent the application from rendering.
        return defaultSettings;
    }
    const settings = {...defaultSettings};
    if (typeof rawSettings !== "object" || rawSettings === null) return settings;
    if ("animationSpeed" in rawSettings && animationSpeedOptions.some(({value}) => value === rawSettings.animationSpeed))
        settings.animationSpeed = rawSettings.animationSpeed as AnimationSpeed;
    if ("theme" in rawSettings && themeOptions.some(({value}) => value === rawSettings.theme))
        settings.theme = rawSettings.theme as Theme;
    if ("editorKeybindings" in rawSettings && editorKeybindingsOptions.some(({value}) => value === rawSettings.editorKeybindings))
        settings.editorKeybindings = rawSettings.editorKeybindings as EditorKeybindings;
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
