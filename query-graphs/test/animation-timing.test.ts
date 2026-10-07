import assert from "node:assert/strict";
import test from "node:test";
import {getGraphAnimationDuration, graphAnimationProgress} from "../src/ui/animation-timing";

test("the selected animation speed resolves to its duration unless motion is disabled", () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    let reducedMotion = false;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {matchMedia: () => ({matches: reducedMotion})},
    });
    try {
        assert.equal(getGraphAnimationDuration("slow"), 500);
        reducedMotion = true;
        assert.equal(getGraphAnimationDuration("slow"), undefined);
    } finally {
        if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
        else Object.defineProperty(globalThis, "window", previousWindow);
    }
});

test("animation progress is eased and clamped", () => {
    const start = 100;
    const duration = 200;
    assert.equal(graphAnimationProgress(start, start - 1, duration), 0);
    assert.equal(graphAnimationProgress(start, start, duration), 0);
    assert.ok(graphAnimationProgress(start, start + duration / 4, duration) < 0.25);
    assert.ok(Math.abs(graphAnimationProgress(start, start + duration / 2, duration) - 0.5) < Number.EPSILON);
    assert.ok(graphAnimationProgress(start, start + (3 * duration) / 4, duration) > 0.75);
    assert.equal(graphAnimationProgress(start, start + duration, duration), 1);
    assert.equal(graphAnimationProgress(start, start + duration + 1, duration), 1);
});
