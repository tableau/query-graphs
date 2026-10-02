import assert from "node:assert/strict";
import test from "node:test";
import {durationForAnimationSpeed, graphAnimationProgress} from "../src/ui/animation-timing";

test("animation speeds resolve to durations unless motion is disabled", () => {
    assert.equal(durationForAnimationSpeed("off", false), undefined);
    assert.equal(durationForAnimationSpeed("fast", false), 100);
    assert.equal(durationForAnimationSpeed("medium", false), 200);
    assert.equal(durationForAnimationSpeed("slow", false), 500);
    assert.equal(durationForAnimationSpeed("excruciating", false), 2000);
    assert.equal(durationForAnimationSpeed("slow", true), undefined);
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
