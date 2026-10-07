import {useSyncExternalStore} from "react";
import {animationSpeedOptions, settingsStore} from "./settings";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

/** Reactively follows the browser's reduced-motion preference. */
export function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(
        (onChange) => {
            const mediaQuery = window.matchMedia(reducedMotionQuery);
            mediaQuery.addEventListener("change", onChange);
            return () => mediaQuery.removeEventListener("change", onChange);
        },
        () => window.matchMedia(reducedMotionQuery).matches,
        () => false,
    );
}

export function getGraphAnimationDuration(): number | undefined {
    if (window.matchMedia(reducedMotionQuery).matches) return undefined;
    const animationSpeed = settingsStore.getState().values.animationSpeed;
    return animationSpeedOptions.find(({value}) => value === animationSpeed)?.duration;
}

export function graphAnimationProgress(startTime: number, now: number, duration: number): number {
    const elapsed = Math.min(1, Math.max(0, (now - startTime) / duration));
    return (1 - Math.cos(Math.PI * elapsed)) / 2;
}
