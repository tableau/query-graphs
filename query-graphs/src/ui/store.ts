import {create} from "zustand";
import {immer} from "zustand/middleware/immer";
import {devtools} from "zustand/middleware";

export interface NodeDimensions {
    headWidth?: number;
    headHeight?: number;
    bodyWidth?: number;
    bodyHeight?: number;
    // The outer `.qg-graph-node` element's own rendered size — unlike `head*`/`body*`, this
    // includes the card's padding and border, i.e. its true visible extent. Used for the group
    // backdrop, which should hug the painted card; layout spacing still uses head/body alone
    // (see `measuredNodeSize` in tree-layout.ts) so it doesn't jump while the expand transition
    // animates the body's height.
    nodeWidth?: number;
    nodeHeight?: number;
}

interface GraphRenderingState {
    init: (expandedSubtrees: Record<string, boolean>) => void;
    // `expandedNodes` tracks which nodes show their property detail panel (toggled by a plain click).
    expandedNodes: Record<string, boolean>;
    toggleExpandedNode: (nodeId: string) => void;
    // `expandedSubtrees` tracks which nodes reveal their `collapsedChildren` (toggled by shift-click or the +/- handle).
    expandedSubtrees: Record<string, boolean>;
    toggleExpandedSubtree: (nodeId: string) => void;
    // Measured on-screen head/body sizes, reported by a ResizeObserver and fed back into layout.
    nodeDimensions: Record<string, NodeDimensions>;
    updateNodeDimensions: (entries: ResizeObserverEntry[]) => unknown;
}

export const useGraphRenderingStore = create<GraphRenderingState>()(
    devtools(
        immer((set, get) => ({
            expandedNodes: {},
            expandedSubtrees: {},
            nodeDimensions: {},
            init: (expandedSubtrees) => {
                set((state) => {
                    state.expandedNodes = {};
                    state.expandedSubtrees = expandedSubtrees;
                    state.nodeDimensions = {};
                });
            },
            toggleExpandedNode: (nodeId) =>
                set((state) => {
                    state.expandedNodes[nodeId] = !get().expandedNodes[nodeId];
                }),
            toggleExpandedSubtree: (nodeId) =>
                set((state) => {
                    state.expandedSubtrees[nodeId] = !get().expandedSubtrees[nodeId];
                }),
            updateNodeDimensions: (entries: ResizeObserverEntry[]) =>
                set((state) => {
                    for (const e of entries) {
                        // Figure out which node was changed
                        const target = e.target as HTMLElement;
                        const id = target.closest(".react-flow__node")?.getAttribute("data-id");
                        if (id === null || id === undefined) continue;
                        // Create an entry for this node, if we don't have it, yet
                        if (!state.nodeDimensions[id]) {
                            state.nodeDimensions[id] = {};
                        }
                        // Update head/body dimensions
                        if (target.classList.contains("qg-graph-node-head")) {
                            state.nodeDimensions[id].headWidth = target.offsetWidth;
                            state.nodeDimensions[id].headHeight = target.offsetHeight;
                        } else if (target.classList.contains("qg-graph-node-body")) {
                            state.nodeDimensions[id].bodyWidth = target.offsetWidth;
                            state.nodeDimensions[id].bodyHeight = target.offsetHeight;
                        } else if (target.classList.contains("qg-graph-node")) {
                            state.nodeDimensions[id].nodeWidth = target.offsetWidth;
                            state.nodeDimensions[id].nodeHeight = target.offsetHeight;
                        }
                    }
                }),
        })),
    ),
);
