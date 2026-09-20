import assert from "node:assert/strict";
import test from "node:test";
import type {Edge} from "@xyflow/react";
import {
    createLayoutInterpolator,
    refreshLayoutData,
    sameLayoutTarget,
    staticLayout,
    transitionAnchors,
} from "../src/ui/animated-layout";
import type {GraphLayout, TransitionAnchors} from "../src/ui/animated-layout";
import {graphAnimationDuration, graphAnimationProgress} from "../src/ui/animation-timing";
import type {QueryGraphNode} from "../src/ui/QueryNode";
import {measurePendingBodyResizes, reconcileDimensions} from "../src/ui/useAnimatedGraphLayout";

const parentAnchors = new Map([["child", {nodeId: "parent", offset: {x: 0, y: 30}}]]);

function node(id: string, x: number, y: number, height = 20): QueryGraphNode {
    return {
        id,
        type: "querynode",
        data: {name: id},
        position: {x, y},
        measured: {width: 40, height},
    };
}

function edge(source: string, target: string): Edge {
    return {id: `${source}->${target}`, source, target};
}

function layout(nodes: QueryGraphNode[], edges: Edge[] = []): GraphLayout {
    return {nodes, edges};
}

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

test("entering nodes and edges emerge from their parent", () => {
    const start = staticLayout(layout([node("parent", 10, 20, 30)]));
    const target = layout([node("parent", 20, 40, 30), node("child", 80, 120)], [edge("parent", "child")]);

    const interpolate = createLayoutInterpolator(start, target, parentAnchors);
    const staged = interpolate(0);
    const child = staged.nodes.find((entry) => entry.node.id === "child");
    assert.deepEqual(child?.position, {x: 10, y: 50});
    assert.equal(child?.opacity, 0);
    assert.equal(child?.transient, true);
    assert.equal(staged.edges[0]?.opacity, 0);
    assert.equal(staged.edges[0]?.transient, true);

    const finished = interpolate(1);
    const finishedChild = finished.nodes.find((entry) => entry.node.id === "child");
    assert.deepEqual(finishedChild?.position, {x: 80, y: 120});
    assert.equal(finishedChild?.opacity, 1);
    assert.equal(finishedChild?.transient, false);
});

test("simultaneous entering and exiting subtrees use independent anchors", () => {
    const start = staticLayout(layout([node("left-parent", 0, 0), node("left-child", 0, 100), node("right-parent", 100, 0)]));
    const target = layout([node("left-parent", 10, 0), node("right-parent", 110, 0), node("right-child", 110, 100)]);
    const anchors: TransitionAnchors = new Map([
        ["left-child", {nodeId: "left-parent", offset: {x: 0, y: 30}}],
        ["right-child", {nodeId: "right-parent", offset: {x: 0, y: 30}}],
    ]);

    const halfway = createLayoutInterpolator(start, target, anchors)(0.5);
    assert.deepEqual(halfway.nodes.find((entry) => entry.node.id === "left-child")?.position, {x: 5, y: 65});
    assert.deepEqual(halfway.nodes.find((entry) => entry.node.id === "right-child")?.position, {x: 105, y: 65});
});

test("transition anchors resolve deep changed subtrees in one ancestry pass", () => {
    const depth = 100;
    const leftNodes = Array.from({length: depth}, (_, index) => node(`left-${index}`, 0, index));
    const rightNodes = Array.from({length: depth}, (_, index) => node(`right-${index}`, 100, index));
    const stableNodes = [node("root", 0, 0), node("left", 0, 10), node("right", 100, 10)];

    class CountingParents extends Map<string, string> {
        reads = 0;

        override get(id: string): string | undefined {
            this.reads++;
            return super.get(id);
        }
    }

    const parents = new CountingParents([
        ["left", "root"],
        ["right", "root"],
        ...leftNodes.map((entry, index) => [entry.id, index === 0 ? "left" : leftNodes[index - 1]!.id] as const),
        ...rightNodes.map((entry, index) => [entry.id, index === 0 ? "right" : rightNodes[index - 1]!.id] as const),
    ]);
    const measured: string[] = [];
    const anchors = transitionAnchors(
        staticLayout(layout([...stableNodes, ...leftNodes])),
        layout([...stableNodes, ...rightNodes]),
        parents,
        (nodeId) => {
            measured.push(nodeId);
            return {nodeId, offset: {x: 0, y: 30}};
        },
    );

    assert.equal(anchors?.size, depth * 2);
    assert.equal(anchors?.get(`left-${depth - 1}`)?.nodeId, "left");
    assert.equal(anchors?.get(`right-${depth - 1}`)?.nodeId, "right");
    assert.equal(parents.reads, depth * 2);
    assert.equal(measured.length, 2);
    assert.deepEqual(new Set(measured), new Set(["left", "right"]));
});

test("transition anchors fail when a required handle cannot be measured", () => {
    const start = staticLayout(layout([node("parent", 0, 0)]));
    const target = layout([node("parent", 0, 0), node("child", 0, 100)]);

    assert.equal(
        transitionAnchors(start, target, new Map([["child", "parent"]]), () => undefined),
        undefined,
    );
});

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
    const nodeIds = new Map();
    const initial = {
        nodeIds,
        measured: new Map([["node", {width: 40, height: 20}]]),
        targets: new Map([["node", {width: 40, height: 20}]]),
    };
    const measured = {width: 80, height: 60};

    const resizing = reconcileDimensions(initial, nodeIds, [["node", measured]], new Set(["node"]));
    assert.equal(resizing.measured.get("node"), measured);
    assert.deepEqual(resizing.targets.get("node"), {width: 40, height: 20});

    const settled = reconcileDimensions(resizing, nodeIds, [["node", measured]], new Set());
    assert.equal(settled.targets.get("node"), measured);
    assert.equal(reconcileDimensions(settled, nodeIds, [["node", measured]], new Set()), settled);
});

test("exiting nodes follow their anchor when an animation is interrupted", () => {
    const expanded = staticLayout(layout([node("parent", 10, 20, 30), node("child", 80, 120)], [edge("parent", "child")]));
    const firstTarget = layout([node("parent", 20, 40, 30)]);
    const interrupted = createLayoutInterpolator(expanded, firstTarget, parentAnchors)(0.5);
    const interruptedChild = interrupted.nodes.find((entry) => entry.node.id === "child");
    assert.deepEqual(interruptedChild?.position, {x: 50, y: 95});

    const movedTarget = layout([node("parent", 100, 100, 30)]);
    const resumed = createLayoutInterpolator(interrupted, movedTarget, parentAnchors)(0.5);
    const resumedChild = resumed.nodes.find((entry) => entry.node.id === "child");
    assert.deepEqual(resumedChild?.position, {x: 75, y: 112.5});
    assert.equal(resumedChild?.opacity, 0.25);

    const finished = createLayoutInterpolator(interrupted, movedTarget, parentAnchors)(1);
    assert.equal(
        finished.nodes.some((entry) => entry.node.id === "child"),
        false,
    );
    assert.equal(finished.edges.length, 0);
});

test("layout target comparison ignores payload changes but detects geometry and membership changes", () => {
    const originalNode = node("node", 10, 20);
    const original = layout([originalNode]);
    const same = layout([{...originalNode, data: {name: "updated"}}]);
    const moved = layout([node("node", 11, 20)]);

    assert.equal(sameLayoutTarget(original, same), true);
    assert.equal(sameLayoutTarget(original, moved), false);
    assert.equal(sameLayoutTarget(original, layout([node("replacement", 10, 20)])), false);

    const originalEdge = edge("node", "node");
    assert.equal(
        sameLayoutTarget(layout([originalNode], [originalEdge]), layout([originalNode], [{...originalEdge, id: "replacement"}])),
        false,
    );
});

test("refreshing layout data preserves animated positions and exiting payloads", () => {
    const originalNode = node("node", 10, 20);
    const exitingNode = node("exiting", 30, 40);
    const exitingEdge = edge("node", "exiting");
    const animated = staticLayout(layout([originalNode, exitingNode], [exitingEdge]));
    animated.nodes[0]!.position = {x: 5, y: 6};

    const refreshed = refreshLayoutData(animated, layout([{...originalNode, data: {name: "updated"}}]));
    assert.equal(refreshed.nodes[0]?.node.data.name, "updated");
    assert.deepEqual(refreshed.nodes[0]?.position, {x: 5, y: 6});
    assert.equal(refreshed.nodes[1]?.node, exitingNode);
    assert.equal(refreshed.edges[0]?.edge, exitingEdge);
});

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
