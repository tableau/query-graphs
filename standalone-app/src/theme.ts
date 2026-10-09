import {createContext, useContext, useSyncExternalStore} from "react";
import {useSettings} from "./settings";

export type ResolvedTheme = "light" | "dark";

export const ThemeContext = createContext<ResolvedTheme>("light");

export function useTheme(): ResolvedTheme {
    return useContext(ThemeContext);
}

const darkThemeQuery = "(prefers-color-scheme: dark)";

export function useResolvedThemeSetting(): ResolvedTheme {
    const theme = useSettings((settings) => settings.values.theme);
    const systemTheme = useSyncExternalStore(
        (onStoreChange) => {
            const mediaQuery = window.matchMedia(darkThemeQuery);
            mediaQuery.addEventListener("change", onStoreChange);
            return () => mediaQuery.removeEventListener("change", onStoreChange);
        },
        () => (window.matchMedia(darkThemeQuery).matches ? "dark" : "light"),
        () => "light" as const,
    );
    return theme === "system" ? systemTheme : theme;
}
