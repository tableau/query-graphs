import assert from "node:assert/strict";
import test from "node:test";
import {applyMeasuredDimensions, preparePendingNodeResizes} from "../src/ui/useAnimatedGraphLayout";

function measuredElement(events: string[], name: string, width: number, height: number): HTMLElement {
    return Object.defineProperties(
        {},
        {
            offsetWidth: {get: () => (events.push(`read ${name}.width`), width)},
            offsetHeight: {get: () => (events.push(`read ${name}.height`), height)},
        },
    ) as unknown as HTMLElement;
}

test("pending node resizes record every measured target", () => {
    const events: string[] = [];
    const resizes = new Map([
        [
            "first",
            {
                nodeElement: measuredElement(events, "first node", 120, 90),
                current: {width: 40, height: 20},
            },
        ],
        [
            "second",
            {
                nodeElement: measuredElement(events, "second node", 140, 100),
                current: {width: 50, height: 30},
            },
        ],
    ]);

    const targets = preparePendingNodeResizes(resizes);

    assert.deepEqual(
        targets,
        new Map([
            ["first", {width: 120, height: 90}],
            ["second", {width: 140, height: 100}],
        ]),
    );
    assert.deepEqual(resizes.get("first")?.target, {width: 120, height: 90});
    assert.deepEqual(resizes.get("second")?.target, {width: 140, height: 100});
    assert.deepEqual(events, [
        "read first node.width",
        "read first node.height",
        "read second node.width",
        "read second node.height",
    ]);
    events.length = 0;
    assert.deepEqual(preparePendingNodeResizes(resizes), new Map());
    assert.deepEqual(events, []);
});

test("pending node resizes preserve active entries and discard unmeasurable entries", () => {
    const events: string[] = [];
    const active = {
        nodeElement: measuredElement(events, "active node", 40, 40),
        current: {width: 10, height: 10},
        target: {width: 30, height: 30},
    };
    const resizes = new Map([
        ["active", active],
        [
            "missing",
            {
                nodeElement: measuredElement(events, "missing node", 0, 0),
                current: {width: 10, height: 10},
            },
        ],
    ]);

    assert.deepEqual(preparePendingNodeResizes(resizes), new Map());
    assert.equal(resizes.get("active"), active);
    assert.equal(resizes.has("missing"), false);
});

test("applying measured dimensions preserves active resize targets until they settle", () => {
    const initial = {
        measured: new Map([["node", {width: 40, height: 20}]]),
        targets: new Map([["node", {width: 40, height: 20}]]),
    };
    const measured = {width: 80, height: 60};

    const resizing = applyMeasuredDimensions(initial, [["node", measured]], new Set(["node"]));
    assert.equal(resizing.measured.get("node"), measured);
    assert.deepEqual(resizing.targets.get("node"), {width: 40, height: 20});

    const settled = applyMeasuredDimensions(resizing, [["node", measured]], new Set());
    assert.equal(settled.targets.get("node"), measured);
    assert.equal(applyMeasuredDimensions(settled, [["node", measured]], new Set()), settled);
});
