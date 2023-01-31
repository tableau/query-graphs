import {create} from "zustand";
import {immer} from "zustand/middleware/immer";
import {devtools} from "zustand/middleware";

export interface NodeDimensions {
    headWidth?: number;
    headHeight?: number;
    bodyWidth?: number;
    bodyHeight?: number;
}

interface GraphRenderingState {
    expandedNodes: Record<string, boolean>;
    toggleExpandedNode: (nodeId: string) => void;
    expandedSubtrees: Record<string, boolean>;
    toggleExpandedSubtree: (nodeId: string) => void;
    nodeDimensions: Record<string, NodeDimensions>;
    updateNodeDimensions: (entries: ResizeObserverEntry[]) => unknown;
}

export const useGraphRenderingStore = create<GraphRenderingState>()(
    devtools(
        immer((set, get) => ({
            expandedNodes: {},
            toggleExpandedNode: nodeId =>
                set(state => {
                    state.expandedNodes[nodeId] = !get().expandedNodes[nodeId];
                }),
            expandedSubtrees: {},
            toggleExpandedSubtree: nodeId =>
                set(state => {
                    state.expandedSubtrees[nodeId] = !get().expandedSubtrees[nodeId];
                }),
            nodeDimensions: {},
            updateNodeDimensions: (entries: ResizeObserverEntry[]) =>
                set(state => {
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
                        }
                    }
                }),
        })),
    ),
);
