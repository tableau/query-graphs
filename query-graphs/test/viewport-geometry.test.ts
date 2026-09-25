import assert from "node:assert/strict";
import test from "node:test";
import {
    primaryDirectionOutsideRectangle,
    viewportBetweenSideObstructions,
    visibleRectangleFraction,
} from "../src/ui/viewport-geometry";

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

// Tree indicators choose one geometrically dominant direction without giving either axis priority.
test("primary rectangle directions compare normalized horizontal and vertical overflow", () => {
    assert.equal(primaryDirectionOutsideRectangle({top: -40, right: 110, bottom: -20, left: 90}, viewport), "above");
    assert.equal(primaryDirectionOutsideRectangle({top: 120, right: 160, bottom: 140, left: 120}, viewport), "right");
    assert.equal(primaryDirectionOutsideRectangle({top: 120, right: 60, bottom: 140, left: 40}, viewport), "below");
    assert.equal(primaryDirectionOutsideRectangle({top: 40, right: -10, bottom: 60, left: -30}, viewport), "left");
});

// Side panels define the unobstructed graph rectangle where edge indicators can remain visible.
test("viewport rectangles are trimmed around side obstructions", () => {
    assert.deepEqual(
        viewportBetweenSideObstructions(viewport, [
            {top: 0, right: 25, bottom: 100, left: 0},
            {top: 20, right: 100, bottom: 80, left: 90},
        ]),
        {top: 0, right: 90, bottom: 100, left: 25},
    );
    assert.equal(viewportBetweenSideObstructions(viewport, [{top: 0, right: 100, bottom: 100, left: 0}]), undefined);
});
