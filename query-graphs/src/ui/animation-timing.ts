export const graphAnimationDuration = 200;

export function graphAnimationsEnabled(): boolean {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function graphAnimationProgress(startTime: number, now: number): number {
    const elapsed = Math.min(1, Math.max(0, (now - startTime) / graphAnimationDuration));
    return (1 - Math.cos(Math.PI * elapsed)) / 2;
}
