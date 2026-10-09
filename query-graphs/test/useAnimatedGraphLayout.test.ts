import assert from "node:assert/strict";
import test from "node:test";
import {applyMeasuredDimensions, preparePendingNodeResizes} from "../src/ui/useAnimatedGraphLayout";

const computedStyles = new WeakMap<HTMLElement, CSSStyleDeclaration>();

function measuredElement(events: string[], name: string, width: number, height: number): HTMLElement {
    const style = {removeProperty: (property: string) => events.push(`remove ${name}.${property}`)};
    for (const property of ["width", "height"])
        Object.defineProperty(style, property, {set: (value) => events.push(`write ${name}.${property}=${value}`)});
    const computedStyle = {boxSizing: "border-box"} as CSSStyleDeclaration;
    Object.defineProperties(computedStyle, {
        width: {get: () => (events.push(`read ${name}.width`), `${width}px`)},
        height: {get: () => (events.push(`read ${name}.height`), `${height}px`)},
    });
    const element = Object.defineProperties(
        {
            ownerDocument: {
                defaultView: {
                    getComputedStyle: (target: HTMLElement) => {
                        const style = computedStyles.get(target);
                        assert.ok(style);
                        return style;
                    },
                },
            },
            classList: {
                add: (className: string) => events.push(`add ${name}.${className}`),
                remove: (className: string) => events.push(`remove ${name}.${className}`),
            },
            style,
        },
        {
            offsetWidth: {get: () => (events.push(`read ${name}.width`), width)},
            offsetHeight: {get: () => (events.push(`read ${name}.height`), height)},
        },
    ) as unknown as HTMLElement;
    computedStyles.set(element, computedStyle);
    return element;
}

test("pending node resizes record outer layout and sizing-shell targets before writing styles", () => {
    const events: string[] = [];
    const firstSizing = measuredElement(events, "first sizing shell", 80.25, 60.75);
    const secondSizing = measuredElement(events, "second sizing shell", 100.5, 70.125);
    const resizes = new Map([
        [
            "first",
            {
                flowElement: measuredElement(events, "first node", 120.375, 90.625),
                sizingElement: firstSizing,
                start: {width: 40.25, height: 20.75},
            },
        ],
        [
            "second",
            {
                flowElement: measuredElement(events, "second node", 140.875, 100.25),
                sizingElement: secondSizing,
                start: {width: 50.5, height: 30.125},
            },
        ],
    ]);

    const targets = preparePendingNodeResizes(resizes);

    assert.deepEqual(
        targets,
        new Map([
            ["first", {width: 120.375, height: 90.625}],
            ["second", {width: 140.875, height: 100.25}],
        ]),
    );
    assert.deepEqual(resizes.get("first")?.target, {width: 80.25, height: 60.75});
    assert.deepEqual(resizes.get("second")?.target, {width: 100.5, height: 70.125});
    const firstWrite = events.findIndex((event) => event.startsWith("write") || event.startsWith("add"));
    const lastRead = events.reduce((last, event, index) => (event.startsWith("read") ? index : last), -1);
    assert.ok(lastRead >= 0 && firstWrite > lastRead);
    assert.ok(events.includes("add first sizing shell.qg-resizing"));
    assert.ok(events.includes("add second sizing shell.qg-resizing"));
    assert.ok(events.includes("write first sizing shell.width=40.25px"));
    assert.ok(events.includes("write second sizing shell.width=50.5px"));
    events.length = 0;
    assert.deepEqual(preparePendingNodeResizes(resizes), new Map());
    assert.deepEqual(events, []);
});

test("pending node resizes preserve active entries and discard unmeasurable entries", () => {
    const events: string[] = [];
    const active = {
        flowElement: measuredElement(events, "active node", 40, 40),
        sizingElement: measuredElement(events, "active sizing shell", 30, 30),
        start: {width: 10, height: 10},
        target: {width: 30, height: 30},
    };
    const resizes = new Map([
        ["active", active],
        [
            "missing",
            {
                flowElement: measuredElement(events, "missing node", 0, 0),
                sizingElement: measuredElement(events, "missing sizing shell", 0, 0),
                start: {width: 10, height: 10},
            },
        ],
    ]);

    assert.deepEqual(preparePendingNodeResizes(resizes), new Map());
    assert.equal(resizes.get("active"), active);
    assert.equal(resizes.has("missing"), false);
});

test("pending node resizes do not freeze a shell whose fractional size is unchanged", () => {
    const events: string[] = [];
    const sizingElement = measuredElement(events, "sizing shell", 80.255, 60.75);
    const resizes = new Map([
        [
            "node",
            {
                flowElement: measuredElement(events, "node", 120.5, 90.25),
                sizingElement,
                start: {width: 80.25, height: 60.75},
            },
        ],
    ]);

    const targets = preparePendingNodeResizes(resizes);

    assert.deepEqual(targets, new Map([["node", {width: 120.5, height: 90.25}]]));
    assert.equal(resizes.has("node"), false);
    assert.equal(
        events.some((event) => event.startsWith("write") || event.startsWith("add")),
        false,
    );
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
