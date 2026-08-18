// Highlight rules — single source of truth for the plan-highlighting heuristics.
//
// Historically each rule's threshold was baked into the node at load time. To let the UI expose
// these thresholds as live-editable controls, the *raw signals* (processed rows, CPU cycles, the
// estimate/actual pair, ...) are stored on each node by the loader, and the threshold *decisions*
// are made here, at render time, from an adjustable `HighlightThresholds`. The loader seeds the
// first render with `DEFAULT_THRESHOLDS`, so the default appearance is unchanged.
//
// This module is pure (no React, no DOM) and is shared by the loader and the UI.

import {TreeNode} from "./tree-description";
import {formatMetric} from "./loader-utils";

// The adjustable numeric thresholds behind the highlight rules. Kept in natural units so the UI can
// present them directly (rows, a ratio, a percentage).
export interface HighlightThresholds {
    // Costly scan: a scan must read at least this many rows before its selectivity is even considered.
    costlyScanMinProcessed: number;
    // Costly scan: processed rows per matched row at or above which the scan is flagged (a zero-match
    // scan is always costly, independent of this ratio).
    costlyScanSelectivityRatio: number;
    // Cardinality misestimate: the larger of estimate/actual must clear this floor to highlight.
    cardinalityFloor: number;
    // Cardinality misestimate: estimate and actual are a "mismatch" when they differ by this factor.
    cardinalityRatio: number;
    // Runtime hotspot: an operator using at least this percentage of the plan's total CPU cycles.
    runtimeHotspotPercent: number;
}

export const DEFAULT_THRESHOLDS: HighlightThresholds = {
    costlyScanMinProcessed: 1_000_000,
    costlyScanSelectivityRatio: 100,
    cardinalityFloor: 100_000,
    cardinalityRatio: 10,
    runtimeHotspotPercent: 5,
};

// One editable numeric input in the rules footer, bound to a single `HighlightThresholds` field.
export interface ThresholdField {
    key: keyof HighlightThresholds;
    label: string;
    // Suffix shown after the input (e.g. "×", "%"). Omitted for a plain row count.
    unit?: string;
    min: number;
    step: number;
}

// Metadata describing a highlight rule for the footer legend/editor: its label, the swatch class
// mirroring its node/edge color, a one-line explanation, and any editable thresholds. Rules with no
// `fields` are boolean facts (an index exists / was used), not tunable heuristics.
export interface HighlightRule {
    key: string;
    label: string;
    swatchClass: string;
    description: string;
    fields: ThresholdField[];
}

export const HIGHLIGHT_RULES: HighlightRule[] = [
    {
        key: "costly-scan",
        label: "Costly scan",
        swatchClass: "qg-swatch-costly-scan",
        description:
            "A scan billed far more rows than matched its restrictions — whole row groups were read " +
            "to return few rows (low selectivity).",
        fields: [
            {key: "costlyScanMinProcessed", label: "Min processed", min: 0, step: 100_000},
            {key: "costlyScanSelectivityRatio", label: "Processed ↔ matched", unit: "×", min: 1, step: 5},
        ],
    },
    {
        key: "cardinality",
        label: "Cardinality misestimate",
        swatchClass: "qg-swatch-cardinality",
        description: "The optimizer's row estimate diverged sharply from the actual row count on an edge.",
        fields: [
            {key: "cardinalityFloor", label: "Min rows", min: 0, step: 10_000},
            {key: "cardinalityRatio", label: "Estimate ↔ actual", unit: "×", min: 1, step: 1},
        ],
    },
    {
        key: "runtime-hotspot",
        label: "Runtime CPU hotspot",
        swatchClass: "qg-swatch-runtime-hotspot",
        description: "An operator consumed a large share of the plan's total CPU cycles.",
        fields: [{key: "runtimeHotspotPercent", label: "Runtime share", unit: "%", min: 0, step: 1}],
    },
    {
        key: "index-rec",
        label: "Index recommendation",
        swatchClass: "qg-swatch-index-rec",
        description:
            "Hyper flagged a column as an index-recommendation candidate — analyze the query " +
            "traffic patterns before building the index; it's a candidate, not a directive.",
        fields: [],
    },
    {
        key: "index-used",
        label: "Index used",
        swatchClass: "qg-swatch-index-used",
        description: "The scan used an existing index — informational, not a guarantee the plan is optimal.",
        fields: [],
    },
];

// Whether a cardinality estimate and its measured actual "mismatch": they differ by more than the
// configured ratio AND the larger side clears the absolute floor. The floor keeps a 36-vs-0 miss
// from highlighting like a 540M-vs-0 one (a >ratio difference is trivially true whenever actual is 0).
export function isCardinalityMismatch(estimate: number, actual: number, t: HighlightThresholds): boolean {
    return (
        Math.max(estimate, actual) >= t.cardinalityFloor &&
        (estimate > actual * t.cardinalityRatio || actual > estimate * t.cardinalityRatio)
    );
}

// Whether a scan is "costly": it reads a meaningful volume and keeps few of those rows. A zero-match
// scan (read everything, kept nothing) is the extreme case and always counts once the volume floor
// is met.
export function isCostlyScan(processedRows: number, rowsMatching: number, t: HighlightThresholds): boolean {
    return (
        processedRows >= t.costlyScanMinProcessed &&
        (rowsMatching === 0 || processedRows >= rowsMatching * t.costlyScanSelectivityRatio)
    );
}

// The proportional red shade for a costly scan, darker the larger this scan's share of all rows read
// by the plan's scans. Mirrors the runtime-hotspot heatmap (see `deriveNodeDisplay`): lightness runs
// from 98% (a negligible share) down to 82% (the scan that read essentially everything), so heavier
// scans read as a deeper red. `processedTotal` is the summed processed-rows across every scan; when it
// is non-positive (no runtime stats) there is nothing to scale against, so fall back to the lightest
// shade. Shared by the loader (bake) and `deriveNodeDisplay` (render-time recompute) so the two never
// diverge.
export function costlyScanShade(processedRows: number, processedTotal: number): string {
    const ratio = processedTotal > 0 ? processedRows / processedTotal : 0;
    // Lightness runs from 98% (negligible share — barely tinted) down to 82% (the scan that read
    // essentially everything). Both ends are kept light on purpose: a low-share scan should be almost
    // white, and even the heaviest reads as a soft heatmap red rather than a saturated error color.
    const l = (98 + (82 - 98) * ratio).toFixed(3);
    return `hsl(0, 100%, ${l}%)`;
}

// The subset of `TreeNode` fields recomputed from thresholds. Merged onto the node's render data.
export interface NodeDisplay {
    highlightNode?: "costly-scan" | "index-rec" | "index-used";
    highlightReason?: string;
    costlyScan?: boolean;
    costlyScanColor?: string;
    nodeColor?: string;
    edgeClass?: string;
    edgeReason?: string;
}

// Recompute a node's threshold-dependent display from its raw signals. This is the render-time
// counterpart of the loader: it reproduces exactly what the loader used to bake, but reads the
// live thresholds so edits re-highlight without reloading the plan.
//
// Precedence for the node color is costly-scan > index-rec > index-used; the runtime-hotspot tint
// is orthogonal (it colors the node label / cpu-cycles row) and its explanation is appended to any
// existing reason. On the edge, a costly scan's reason overrides a cardinality misestimate's.
export function deriveNodeDisplay(
    node: TreeNode,
    t: HighlightThresholds,
    planCpuTotal: number,
    planProcessedTotal: number,
): NodeDisplay {
    const display: NodeDisplay = {};

    // Costly scan (top-precedence node color).
    const costly =
        typeof node.scanProcessedRows === "number" &&
        typeof node.scanRowsMatching === "number" &&
        isCostlyScan(node.scanProcessedRows, node.scanRowsMatching, t);
    let costlyReason: string | undefined;
    if (costly) {
        // `processed-rows` is billed at row-group granularity: the whole row group is billed once any
        // page in it is fetched/decoded, so it reflects billing cost, not rows literally scanned. A
        // low match-per-processed ratio means many row groups were read/billed to return few rows.
        costlyReason =
            `Costly scan: billed ${formatMetric(node.scanProcessedRows!)} rows (whole row groups), ` +
            `only ${formatMetric(node.scanRowsMatching!)} matched the restrictions — few matches per row group read.`;
        display.highlightNode = "costly-scan";
        display.highlightReason = costlyReason;
        display.costlyScan = true;
        // Shade the node box proportionally to this scan's share of all rows the plan's scans read,
        // the same heatmap the loader bakes (see `shadeCostlyScans` in hyper.ts).
        display.costlyScanColor = costlyScanShade(node.scanProcessedRows!, planProcessedTotal);
    } else if (node.baseHighlight) {
        // Fall back to the non-threshold node category (index recommendation or index used).
        display.highlightNode = node.baseHighlight;
        display.highlightReason = node.baseHighlightReason;
    }

    // Cardinality misestimate on the incoming edge.
    if (typeof node.cardEstimate === "number" && typeof node.cardActual === "number") {
        if (isCardinalityMismatch(node.cardEstimate, node.cardActual, t)) {
            display.edgeClass = "qg-label-highlighted";
            const dir = node.cardEstimate > node.cardActual ? "over-estimated" : "under-estimated";
            // Scans report the matched-restrictions count as their "actual"; generic operators report
            // measured output. Word the two cases accordingly.
            const tail = node.cardIsScan
                ? `estimated ${formatMetric(node.cardEstimate)} rows, ${formatMetric(node.cardActual)} matched the restrictions.`
                : `estimated ${formatMetric(node.cardEstimate)} rows, actual ${formatMetric(node.cardActual)}.`;
            const subject = node.cardIsScan ? "this scan's output" : "this operator's output";
            display.edgeReason = `Cardinality misestimate: the optimizer ${dir} ${subject} — ${tail}`;
        }
    }
    // A costly scan's reason takes precedence as the edge tooltip too, and always highlights the edge.
    if (costly) {
        display.edgeClass = "qg-label-highlighted";
        display.edgeReason = costlyReason;
    }

    // Runtime hotspot (orthogonal violet tint on the node label / cpu-cycles row). A distinct hue
    // from the magenta cardinality-misestimate edge highlight, so the two rules never read alike.
    if (typeof node.cpuTime === "number" && planCpuTotal > 0) {
        const ratio = node.cpuTime / planCpuTotal;
        if (ratio >= t.runtimeHotspotPercent / 100) {
            const l = (95 + (72 - 95) * ratio).toFixed(3);
            display.nodeColor = `hsl(265, 70%, ${l}%)`;
            const pct = Math.round(ratio * 100);
            const cpuReason = `Runtime CPU hotspot: used ${formatMetric(node.cpuTime)} CPU cycles — ${pct}% of the plan's total runtime.`;
            // Each reason on its own line so multiple findings on one node stay legible.
            display.highlightReason = display.highlightReason ? `${display.highlightReason}\n${cpuReason}` : cpuReason;
            // Match the loader's original behavior: only append to an edge reason that already exists.
            if (display.edgeReason) display.edgeReason = `${display.edgeReason}\n${cpuReason}`;
        }
    }

    return display;
}
