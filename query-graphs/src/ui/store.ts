import {create} from "zustand";
import {immer} from "zustand/middleware/immer";
import {devtools} from "zustand/middleware";
import {HighlightThresholds, DEFAULT_THRESHOLDS} from "../highlight-rules";

export interface NodeDimensions {
    headWidth?: number;
    headHeight?: number;
    bodyWidth?: number;
    bodyHeight?: number;
}

interface GraphRenderingState {
    init: (expandedSubtrees: Record<string, boolean>) => void;
    expandedNodes: Record<string, boolean>;
    toggleExpandedNode: (nodeId: string) => void;
    expandedSubtrees: Record<string, boolean>;
    toggleExpandedSubtree: (nodeId: string) => void;
    nodeDimensions: Record<string, NodeDimensions>;
    updateNodeDimensions: (entries: ResizeObserverEntry[]) => unknown;
    // When true, non-flagged nodes are dimmed so highlighted issues stand out (focus mode).
    focusIssues: boolean;
    setFocusIssues: (focus: boolean) => void;
    // Live-editable thresholds behind the highlight rules. Editing one re-highlights the plan without
    // reloading it (see highlight-rules.ts). Reset to defaults when a new plan is loaded.
    highlightThresholds: HighlightThresholds;
    setThreshold: (key: keyof HighlightThresholds, value: number) => void;
    resetThresholds: () => void;
}

export const useGraphRenderingStore = create<GraphRenderingState>()(
    devtools(
        immer((set, get) => ({
            expandedNodes: {},
            expandedSubtrees: {},
            nodeDimensions: {},
            focusIssues: false,
            highlightThresholds: {...DEFAULT_THRESHOLDS},
            init: (expandedSubtrees) => {
                set((state) => {
                    state.expandedNodes = {};
                    state.expandedSubtrees = expandedSubtrees;
                    state.nodeDimensions = {};
                    state.focusIssues = false;
                    state.highlightThresholds = {...DEFAULT_THRESHOLDS};
                });
            },
            setFocusIssues: (focus) =>
                set((state) => {
                    state.focusIssues = focus;
                }),
            setThreshold: (key, value) =>
                set((state) => {
                    state.highlightThresholds[key] = value;
                }),
            resetThresholds: () =>
                set((state) => {
                    state.highlightThresholds = {...DEFAULT_THRESHOLDS};
                }),
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
                        }
                    }
                }),
        })),
    ),
);
