import {useSyncExternalStore} from "react";
import type {AnimationSpeed} from "./settings";
import {settingsStore} from "./settings";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

const animationDurations: Record<AnimationSpeed, number | undefined> = {
    off: undefined,
    fast: 100,
    medium: 200,
    slow: 500,
    excruciating: 2000,
};

export function durationForAnimationSpeed(animationSpeed: AnimationSpeed, reducedMotion: boolean): number | undefined {
    return reducedMotion ? undefined : animationDurations[animationSpeed];
}

function reducedMotionPreference(): boolean {
    return typeof window !== "undefined" && window.matchMedia(reducedMotionQuery).matches;
}

function subscribeToReducedMotion(onChange: () => void): () => void {
    const mediaQuery = window.matchMedia(reducedMotionQuery);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
}

/** Reactively follows the browser's reduced-motion preference. */
export function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(subscribeToReducedMotion, reducedMotionPreference, () => false);
}

export function getGraphAnimationDuration(): number | undefined {
    const animationSpeed = settingsStore.getState().values.animationSpeed;
    return durationForAnimationSpeed(animationSpeed, reducedMotionPreference());
}

export function graphAnimationProgress(startTime: number, now: number, duration: number): number {
    const elapsed = Math.min(1, Math.max(0, (now - startTime) / duration));
    return (1 - Math.cos(Math.PI * elapsed)) / 2;
}
