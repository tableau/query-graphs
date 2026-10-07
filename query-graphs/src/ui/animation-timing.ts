import {useSyncExternalStore} from "react";

export const animationSpeedOptions = [
    {value: "off", label: "Off", duration: undefined},
    {value: "fast", label: "Fast", duration: 100},
    {value: "medium", label: "Medium", duration: 200},
    {value: "slow", label: "Slow", duration: 500},
    {value: "debug", label: "Debug", duration: 5000},
] as const;

export type AnimationSpeed = (typeof animationSpeedOptions)[number]["value"];

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

export function getGraphAnimationDuration(animationSpeed: AnimationSpeed): number | undefined {
    if (window.matchMedia(reducedMotionQuery).matches) return undefined;
    return animationSpeedOptions.find(({value}) => value === animationSpeed)?.duration;
}

export function graphAnimationProgress(startTime: number, now: number, duration: number): number {
    const elapsed = Math.min(1, Math.max(0, (now - startTime) / duration));
    return (1 - Math.cos(Math.PI * elapsed)) / 2;
}
