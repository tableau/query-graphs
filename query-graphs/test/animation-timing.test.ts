import assert from "node:assert/strict";
import test from "node:test";
import {graphAnimationDuration, graphAnimationProgress} from "../src/ui/animation-timing";

test("animation progress is eased and clamped", () => {
    const start = 100;
    assert.equal(graphAnimationProgress(start, start - 1), 0);
    assert.equal(graphAnimationProgress(start, start), 0);
    assert.ok(graphAnimationProgress(start, start + graphAnimationDuration / 4) < 0.25);
    assert.ok(Math.abs(graphAnimationProgress(start, start + graphAnimationDuration / 2) - 0.5) < Number.EPSILON);
    assert.ok(graphAnimationProgress(start, start + (3 * graphAnimationDuration) / 4) > 0.75);
    assert.equal(graphAnimationProgress(start, start + graphAnimationDuration), 1);
    assert.equal(graphAnimationProgress(start, start + graphAnimationDuration + 1), 1);
});
