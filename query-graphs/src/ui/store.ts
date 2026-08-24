import type {Dimensions} from "@xyflow/react";
import {createContext, useContext} from "react";
import {useStore} from "zustand";
import {devtools} from "zustand/middleware";
import {createStore} from "zustand/vanilla";
import type {StoreApi} from "zustand/vanilla";
import {assertNotNull} from "../assert";

export interface NodeSizeAnimation {
    from: Dimensions;
    to: Dimensions;
    startedAt: number;
}

export interface LayoutAnimation {
    kind: "resize" | "subtree";
    startedAt: number;
    // Entering and exiting nodes animate from or toward this node's position.
    anchorNodeId?: string;
}

export interface GraphNodeDimensions {
    // React Flow's latest measurement, preserved on its controlled node object.
    measured: Dimensions;
    // The endpoint used for layout, frozen while the measured size animates toward it.
    target: Dimensions;
}

export interface GraphRenderingState {
    // `expandedNodes` tracks which nodes show their property detail panel (toggled by a plain click).
    expandedNodes: Record<string, boolean>;
    toggleExpandedNode: (nodeId: string, targetDimensions: Dimensions, sizeAnimation: NodeSizeAnimation | undefined) => void;
    finishNodeAnimation: (nodeId: string) => void;
    // `expandedSubtrees` tracks which nodes reveal their `collapsedChildren` (toggled by shift-click or the +/- handle).
    expandedSubtrees: Record<string, boolean>;
    toggleExpandedSubtree: (nodeId: string, startedAt: number | undefined) => void;
    nodeDimensions: ReadonlyMap<string, GraphNodeDimensions>;
    nodeSizeAnimations: ReadonlyMap<string, NodeSizeAnimation>;
    layoutAnimation: LayoutAnimation | undefined;
    updateNodeMeasurements: (updates: readonly (readonly [string, Dimensions])[]) => void;
}

export type GraphRenderingStore = StoreApi<GraphRenderingState>;

export function createGraphRenderingStore(expandedSubtrees: Record<string, boolean>): GraphRenderingStore {
    return createStore<GraphRenderingState>()(
        devtools((set) => ({
            expandedNodes: {},
            expandedSubtrees,
            toggleExpandedNode: (nodeId, targetDimensions, sizeAnimation) =>
                set((state) => {
                    const nodeSizeAnimations = new Map(state.nodeSizeAnimations);
                    if (sizeAnimation === undefined) nodeSizeAnimations.delete(nodeId);
                    else nodeSizeAnimations.set(nodeId, sizeAnimation);
                    const nodeDimensions = new Map(state.nodeDimensions);
                    const previousDimensions = nodeDimensions.get(nodeId);
                    nodeDimensions.set(nodeId, {
                        measured: previousDimensions?.measured ?? targetDimensions,
                        target: targetDimensions,
                    });
                    return {
                        expandedNodes: {
                            ...state.expandedNodes,
                            [nodeId]: !state.expandedNodes[nodeId],
                        },
                        nodeDimensions,
                        nodeSizeAnimations,
                        layoutAnimation:
                            sizeAnimation === undefined ? undefined : {kind: "resize", startedAt: sizeAnimation.startedAt},
                    };
                }),
            finishNodeAnimation: (nodeId) =>
                set((state) => {
                    if (!state.nodeSizeAnimations.has(nodeId)) return state;
                    const nodeSizeAnimations = new Map(state.nodeSizeAnimations);
                    nodeSizeAnimations.delete(nodeId);
                    return {nodeSizeAnimations};
                }),
            toggleExpandedSubtree: (nodeId, startedAt) =>
                set((state) => ({
                    expandedSubtrees: {
                        ...state.expandedSubtrees,
                        [nodeId]: !state.expandedSubtrees[nodeId],
                    },
                    layoutAnimation: startedAt === undefined ? undefined : {kind: "subtree", startedAt, anchorNodeId: nodeId},
                })),
            nodeDimensions: new Map(),
            nodeSizeAnimations: new Map(),
            layoutAnimation: undefined,
            updateNodeMeasurements: (updates) =>
                set((state) => {
                    let nodeDimensions: Map<string, GraphNodeDimensions> | undefined;
                    for (const [nodeId, measured] of updates) {
                        const previous = state.nodeDimensions.get(nodeId);
                        const target = state.nodeSizeAnimations.has(nodeId) ? (previous?.target ?? measured) : measured;
                        if (
                            previous?.measured.width === measured.width &&
                            previous.measured.height === measured.height &&
                            previous.target.width === target.width &&
                            previous.target.height === target.height
                        )
                            continue;
                        nodeDimensions ??= new Map(state.nodeDimensions);
                        nodeDimensions.set(nodeId, {measured, target});
                    }
                    return nodeDimensions === undefined ? state : {nodeDimensions};
                }),
        })),
    );
}

export const GraphRenderingStoreContext = createContext<GraphRenderingStore | null>(null);

export function useGraphRenderingStore<T>(selector: (state: GraphRenderingState) => T): T {
    const store = useContext(GraphRenderingStoreContext);
    assertNotNull(store);
    return useStore(store, selector);
}
