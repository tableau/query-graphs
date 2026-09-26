import assert from "node:assert/strict";
import test from "node:test";
import {horizontalViewportInsets, visibleRectangleFraction} from "../src/ui/viewport-geometry";

const viewport = {top: 0, right: 100, bottom: 100, left: 0};

// Viewport clipping reports the actual visible fraction, including the exact threshold and tiny edge slivers.
test("visible rectangle fractions account for viewport clipping", () => {
    assert.equal(visibleRectangleFraction({top: 10, right: 90, bottom: 90, left: 10}, viewport, []), 1);
    assert.equal(visibleRectangleFraction({top: 0, right: 200, bottom: 100, left: 0}, viewport, []), 0.5);
    assert.equal(visibleRectangleFraction({top: 0, right: 150, bottom: 100, left: 50}, viewport, []), 0.5);
    assert.equal(visibleRectangleFraction({top: 0, right: 151, bottom: 100, left: 51}, viewport, []), 0.49);
    assert.equal(visibleRectangleFraction({top: 0, right: 100, bottom: 100, left: 99}, viewport, []), 1);
    assert.equal(visibleRectangleFraction({top: 0, right: 199, bottom: 100, left: 99}, viewport, []), 0.01);
});

// Obstructions are subtracted as a union, so overlapping panels never double-subtract the same pixels.
test("visible rectangle fractions account for overlapping viewport obstructions", () => {
    const rectangle = {top: 0, right: 100, bottom: 100, left: 0};
    assert.equal(visibleRectangleFraction(rectangle, viewport, [{top: 0, right: 25, bottom: 100, left: 0}]), 0.75);
    assert.equal(
        visibleRectangleFraction(rectangle, viewport, [
            {top: 0, right: 60, bottom: 100, left: 0},
            {top: 0, right: 80, bottom: 100, left: 40},
        ]),
        0.2,
    );
});

// Graph navigation reserves sidebar space on its nearest edge and declines to fit a fully covered viewport.
test("horizontal viewport insets account for obstructing panels", () => {
    assert.deepEqual(horizontalViewportInsets(viewport, [], 10), {left: 10, right: 10});
    assert.deepEqual(horizontalViewportInsets(viewport, [{top: 0, right: 35, bottom: 100, left: 0}], 10), {
        left: 45,
        right: 10,
    });
    assert.deepEqual(horizontalViewportInsets(viewport, [{top: 0, right: 100, bottom: 100, left: 75}], 10), {
        left: 10,
        right: 35,
    });
    assert.equal(horizontalViewportInsets(viewport, [{top: 0, right: 100, bottom: 100, left: 0}], 10), undefined);
});
