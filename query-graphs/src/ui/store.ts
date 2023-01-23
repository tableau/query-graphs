import {create} from "zustand";
import {immer} from "zustand/middleware/immer";
import {devtools} from "zustand/middleware";

interface GraphRenderingState {
    expandedNodes: Record<string, boolean>;
    toggleExpandedNode: (nodeId: string) => void;
    expandedSubtrees: Record<string, boolean>;
    toggleExpandedSubtree: (nodeId: string) => void;
}

export const useGraphRenderingStore = create<GraphRenderingState>()(
    devtools(
        immer((set, get) => ({
            expandedNodes: {},
            expandedSubtrees: {},
            toggleExpandedNode: nodeId =>
                set(state => {
                    state.expandedNodes[nodeId] = !get().expandedNodes[nodeId];
                }),
            toggleExpandedSubtree: nodeId =>
                set(state => {
                    state.expandedSubtrees[nodeId] = !get().expandedSubtrees[nodeId];
                }),
        })),
    ),
);
