import assert from "node:assert/strict";
import test from "node:test";
import type {Edge} from "@xyflow/react";
import {interpolateLayout, matchesTargetGeometry, refreshLayoutData, sameGeometry, staticLayout} from "../src/ui/animated-layout";
import type {GraphLayout} from "../src/ui/animated-layout";
import {graphAnimationDuration, graphAnimationProgress} from "../src/ui/animation-timing";
import type {QueryGraphNode} from "../src/ui/QueryNode";

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

test("entering nodes and edges emerge from their parent", () => {
    const start = staticLayout(layout([node("parent", 10, 20, 30)]));
    const target = layout([node("parent", 20, 40, 30), node("child", 80, 120)], [edge("parent", "child")]);

    const staged = interpolateLayout(start, target, "parent", 0);
    const child = staged.nodes.find((entry) => entry.node.id === "child");
    assert.deepEqual(child?.position, {x: 10, y: 50});
    assert.equal(child?.opacity, 0);
    assert.equal(child?.transient, true);
    assert.equal(staged.edges[0]?.opacity, 0);
    assert.equal(staged.edges[0]?.transient, true);

    const finished = interpolateLayout(start, target, "parent", 1);
    const finishedChild = finished.nodes.find((entry) => entry.node.id === "child");
    assert.deepEqual(finishedChild?.position, {x: 80, y: 120});
    assert.equal(finishedChild?.opacity, 1);
    assert.equal(finishedChild?.transient, false);
});

test("exiting nodes retain their destination when an animation is interrupted", () => {
    const expanded = staticLayout(layout([node("parent", 10, 20, 30), node("child", 80, 120)], [edge("parent", "child")]));
    const firstTarget = layout([node("parent", 20, 40, 30)]);
    const interrupted = interpolateLayout(expanded, firstTarget, "parent", 0.5);
    const interruptedChild = interrupted.nodes.find((entry) => entry.node.id === "child");
    assert.deepEqual(interruptedChild?.exitPosition, {x: 20, y: 70});

    const movedTarget = layout([node("parent", 100, 100, 30)]);
    const resumed = interpolateLayout(interrupted, movedTarget, "parent", 0.5);
    const resumedChild = resumed.nodes.find((entry) => entry.node.id === "child");
    assert.deepEqual(resumedChild?.exitPosition, {x: 20, y: 70});
    assert.deepEqual(resumedChild?.position, {x: 35, y: 82.5});
    assert.equal(resumedChild?.opacity, 0.25);

    const finished = interpolateLayout(interrupted, movedTarget, "parent", 1);
    assert.equal(
        finished.nodes.some((entry) => entry.node.id === "child"),
        false,
    );
    assert.equal(finished.edges.length, 0);
});

test("layout comparisons distinguish geometry while refreshed data preserves animated positions", () => {
    const originalNode = node("node", 10, 20);
    const original = layout([originalNode]);
    const same = layout([{...originalNode, data: {name: "updated"}}]);
    const moved = layout([node("node", 11, 20)]);

    assert.equal(sameGeometry(original, same), true);
    assert.equal(sameGeometry(original, moved), false);

    const animated = staticLayout(original);
    animated.nodes[0]!.position = {x: 5, y: 6};
    const refreshed = refreshLayoutData(animated, same);
    assert.equal(refreshed.nodes[0]?.node.data.name, "updated");
    assert.deepEqual(refreshed.nodes[0]?.position, {x: 5, y: 6});
    assert.equal(matchesTargetGeometry(refreshed, same), false);
});

test("animation progress is eased and clamped", () => {
    const start = 100;
    assert.equal(graphAnimationProgress(start, start - 1), 0);
    assert.equal(graphAnimationProgress(start, start), 0);
    assert.ok(Math.abs(graphAnimationProgress(start, start + graphAnimationDuration / 2) - 0.5) < Number.EPSILON);
    assert.equal(graphAnimationProgress(start, start + graphAnimationDuration), 1);
    assert.equal(graphAnimationProgress(start, start + graphAnimationDuration + 1), 1);
});
