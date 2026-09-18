import type {Dimensions} from "@xyflow/react";
import {createContext, useContext} from "react";
import {useStore} from "zustand";
import {devtools} from "zustand/middleware";
import {createStore} from "zustand/vanilla";
import type {StoreApi} from "zustand/vanilla";
import {assertNotNull} from "../assert";

export interface GraphRenderingState {
    // `expandedNodes` tracks which nodes show their property detail panel (toggled by a plain click).
    expandedNodes: Record<string, boolean>;
    toggleExpandedNode: (nodeId: string) => void;
    // `expandedSubtrees` tracks which nodes reveal their `collapsedChildren` (toggled by shift-click or the +/- handle).
    expandedSubtrees: Record<string, boolean>;
    toggleExpandedSubtree: (nodeId: string) => void;
    nodeDimensions: Map<string, Dimensions>;
    updateNodeDimensions: (updates: readonly (readonly [string, Dimensions])[]) => void;
}

export type GraphRenderingStore = StoreApi<GraphRenderingState>;

export function createGraphRenderingStore(expandedSubtrees: Record<string, boolean>): GraphRenderingStore {
    return createStore<GraphRenderingState>()(
        devtools((set) => ({
            expandedNodes: {},
            expandedSubtrees,
            toggleExpandedNode: (nodeId) =>
                set((state) => ({
                    expandedNodes: {
                        ...state.expandedNodes,
                        [nodeId]: !state.expandedNodes[nodeId],
                    },
                })),
            toggleExpandedSubtree: (nodeId) =>
                set((state) => ({
                    expandedSubtrees: {
                        ...state.expandedSubtrees,
                        [nodeId]: !state.expandedSubtrees[nodeId],
                    },
                })),
            nodeDimensions: new Map(),
            updateNodeDimensions: (updates) =>
                set((state) => {
                    let nodeDimensions: Map<string, Dimensions> | undefined;
                    for (const [nodeId, dimensions] of updates) {
                        const previous = state.nodeDimensions.get(nodeId);
                        if (previous?.width === dimensions.width && previous.height === dimensions.height) continue;
                        nodeDimensions ??= new Map(state.nodeDimensions);
                        nodeDimensions.set(nodeId, dimensions);
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
