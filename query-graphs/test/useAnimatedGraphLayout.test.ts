import assert from "node:assert/strict";
import test from "node:test";
import {measurePendingBodyResizes, reconcileDimensions} from "../src/ui/useAnimatedGraphLayout";

function measuredElement(events: string[], name: string, width: number, height: number): HTMLElement {
    const style = {removeProperty: (property: string) => events.push(`remove ${name}.${property}`)};
    for (const property of ["width", "height", "maxWidth", "maxHeight"])
        Object.defineProperty(style, property, {set: (value) => events.push(`write ${name}.${property}=${value}`)});
    return Object.defineProperties(
        {style},
        {
            offsetWidth: {get: () => (events.push(`read ${name}.width`), width)},
            offsetHeight: {get: () => (events.push(`read ${name}.height`), height)},
        },
    ) as unknown as HTMLElement;
}

test("pending body resizes read every target before freezing any body", () => {
    const events: string[] = [];
    const firstBody = measuredElement(events, "first body", 80, 60);
    const secondBody = measuredElement(events, "second body", 100, 70);
    const resizes = new Map([
        [
            "first",
            {
                nodeElement: measuredElement(events, "first node", 120, 90),
                bodyElement: firstBody,
                bodyStart: {width: 40, height: 20},
            },
        ],
        [
            "second",
            {
                nodeElement: measuredElement(events, "second node", 140, 100),
                bodyElement: secondBody,
                bodyStart: {width: 50, height: 30},
            },
        ],
    ]);

    const targets = measurePendingBodyResizes(resizes);

    assert.deepEqual(
        targets,
        new Map([
            ["first", {width: 120, height: 90}],
            ["second", {width: 140, height: 100}],
        ]),
    );
    const firstWrite = events.findIndex((event) => event.startsWith("write"));
    const lastRead = events.reduce((last, event, index) => (event.startsWith("read") ? index : last), -1);
    assert.ok(lastRead >= 0 && firstWrite > lastRead);
    assert.ok(events.includes("write first body.width=40px"));
    assert.ok(events.includes("write second body.width=50px"));
    assert.deepEqual(resizes.get("first")?.bodyTarget, {width: 80, height: 60});
    assert.deepEqual(resizes.get("second")?.bodyTarget, {width: 100, height: 70});
});

test("pending body resizes preserve active entries and discard unmeasurable entries", () => {
    const events: string[] = [];
    const active = {
        nodeElement: measuredElement(events, "active node", 40, 40),
        bodyElement: measuredElement(events, "active body", 30, 30),
        bodyStart: {width: 10, height: 10},
        bodyTarget: {width: 30, height: 30},
    };
    const resizes = new Map([
        ["active", active],
        [
            "missing",
            {
                nodeElement: measuredElement(events, "missing node", 0, 0),
                bodyElement: measuredElement(events, "missing body", 0, 0),
                bodyStart: {width: 10, height: 10},
            },
        ],
    ]);

    assert.deepEqual(measurePendingBodyResizes(resizes), new Map());
    assert.equal(resizes.get("active"), active);
    assert.equal(resizes.has("missing"), false);
    assert.ok(events.includes("remove missing body.width"));
});

test("dimension reconciliation preserves active resize targets until they settle", () => {
    const initial = {
        measured: new Map([["node", {width: 40, height: 20}]]),
        targets: new Map([["node", {width: 40, height: 20}]]),
    };
    const measured = {width: 80, height: 60};

    const resizing = reconcileDimensions(initial, [["node", measured]], new Set(["node"]));
    assert.equal(resizing.measured.get("node"), measured);
    assert.deepEqual(resizing.targets.get("node"), {width: 40, height: 20});

    const settled = reconcileDimensions(resizing, [["node", measured]], new Set());
    assert.equal(settled.targets.get("node"), measured);
    assert.equal(reconcileDimensions(settled, [["node", measured]], new Set()), settled);
});
