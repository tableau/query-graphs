// Highlight rules — single source of truth for the plan-highlighting heuristics.
//
// Historically each rule's threshold was baked into the node at load time. To let the UI expose
// these thresholds as live-editable controls, the *raw signals* (processed rows, CPU cycles, the
// estimate/actual pair, ...) are stored on each node by the loader, and the threshold *decisions*
// are made here, at render time, from an adjustable `HighlightThresholds`. The loader seeds the
// first render with `DEFAULT_THRESHOLDS`, so the default appearance is unchanged.
//
// This module is pure (no React, no DOM) and is shared by the loader and the UI.

import type {TreeNode} from "./tree-description";
import {formatMetric, formatBytes} from "./loaders/loader-utils";

// The adjustable numeric thresholds behind the highlight rules. Kept in natural units so the UI can
// present them directly (rows, a ratio, a percentage).
export interface HighlightThresholds {
    // Costly scan: a scan must read at least this many rows before its selectivity is even considered.
    costlyScanMinProcessed: number;
    // Costly scan: processed rows per matched row at or above which the scan is flagged (a zero-match
    // scan is always costly, independent of this ratio).
    costlyScanSelectivityRatio: number;
    // High-volume scan: a scan reads at least this many rows, regardless of selectivity. Catches the
    // "massive but efficient" reads a costly scan misses (all rows matched, but the sheer volume is
    // itself worth calling out as an optimization target).
    highVolumeScanMinProcessed: number;
    // Cardinality misestimate: the larger of estimate/actual must clear this floor to highlight.
    cardinalityFloor: number;
    // Cardinality misestimate: estimate and actual are a "mismatch" when they differ by this factor.
    cardinalityRatio: number;
    // Runtime hotspot: an operator using at least this percentage of the plan's total CPU cycles.
    runtimeHotspotPercent: number;
    // Memory hotspot: an operator holding at least this percentage of the plan's total peak memory.
    memoryHotspotPercent: number;
}

export const DEFAULT_THRESHOLDS: HighlightThresholds = {
    costlyScanMinProcessed: 1_000_000,
    costlyScanSelectivityRatio: 100,
    // A scan reading 100M+ rows is "high volume" regardless of how many it kept — big enough to be
    // worth a look on its own.
    highVolumeScanMinProcessed: 100_000_000,
    cardinalityFloor: 100_000,
    cardinalityRatio: 10,
    runtimeHotspotPercent: 5,
    // Memory concentrates in fewer operators than CPU does, so use a higher default share before
    // flagging — otherwise nearly every operator on a small plan would light up.
    memoryHotspotPercent: 20,
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
        label: "Inefficient scan",
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
        key: "high-volume-scan",
        label: "High-volume scan",
        swatchClass: "qg-swatch-high-volume-scan",
        description:
            "A scan read a very large number of rows — even if it kept most of them, the sheer volume " +
            "dominates the plan's cost and is worth a look (can it be filtered earlier or read less?).",
        fields: [{key: "highVolumeScanMinProcessed", label: "Min processed", min: 0, step: 10_000_000}],
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
        key: "memory-hotspot",
        label: "Memory hotspot",
        swatchClass: "qg-swatch-memory-hotspot",
        description: "An operator held a large share of the plan's total peak memory.",
        fields: [{key: "memoryHotspotPercent", label: "Memory share", unit: "%", min: 0, step: 1}],
    },
    {
        key: "duplicate-columns",
        label: "Duplicate output columns",
        swatchClass: "qg-swatch-duplicate-columns",
        description:
            "This operator's output projects the same column name more than once — often a sign of an " +
            "over-broad or accidentally repeated projection worth double-checking.",
        fields: [],
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

// Whether a scan is "high volume": it read at least the configured number of rows, regardless of how
// selective it was. Orthogonal to `isCostlyScan` (which is about selectivity waste) — a scan can be
// high volume without being costly (all rows matched) and vice versa.
export function isHighVolumeScan(processedRows: number, t: HighlightThresholds): boolean {
    return processedRows >= t.highVolumeScanMinProcessed;
}

// The hover-tooltip reason for a high-volume scan. Shared by the loader (bake) and `deriveNodeDisplay`
// (render-time recompute) so the two never diverge.
export function highVolumeScanReason(processedRows: number): string {
    return (
        `High-volume scan: read ${formatMetric(processedRows)} rows. Even efficient, a read this large ` +
        `dominates the plan's cost — worth checking whether it can be filtered earlier or narrowed.`
    );
}

// The hover-tooltip reason for a costly (inefficient) scan. `processed-rows` is billed at row-group
// granularity, so a low match-per-processed ratio means many row groups were read to return few rows.
// Shared by the loader (bake) and `deriveNodeDisplay` (render-time recompute) so the two never diverge.
export function costlyScanReason(processedRows: number, rowsMatching: number): string {
    return (
        `Inefficient scan: billed ${formatMetric(processedRows)} rows (whole row groups), ` +
        `only ${formatMetric(rowsMatching)} matched the restrictions — few matches per row group read.`
    );
}

// The hover-tooltip reason for a runtime (CPU) hotspot; `pct` is the operator's rounded share of the
// plan's total CPU cycles. Shared by the loader and `deriveNodeDisplay`.
export function runtimeHotspotReason(cpuCycles: number, pct: number): string {
    return `Runtime CPU hotspot: used ${formatMetric(cpuCycles)} CPU cycles — ${pct}% of the plan's total runtime.`;
}

// The hover-tooltip reason for a memory hotspot; `pct` is the operator's rounded share of the plan's
// total peak memory. Shared by the loader and `deriveNodeDisplay`.
export function memoryHotspotReason(bytes: number, pct: number): string {
    return `Memory hotspot: held ${formatBytes(bytes)} — ${pct}% of the plan's total peak memory.`;
}

// A proportional "heatmap" shade: interpolate lightness from `lightStart` (a negligible share) down to
// `lightEnd` (essentially the whole plan) by `ratio`, at a fixed hue/saturation. The costly-scan,
// runtime, and memory heatmaps differ only in their hue and lightness endpoints, so they share this.
function heatShade(hue: number, saturation: number, lightStart: number, lightEnd: number, ratio: number): string {
    const l = (lightStart + (lightEnd - lightStart) * ratio).toFixed(3);
    return `hsl(${hue}, ${saturation}%, ${l}%)`;
}

// The proportional red shade for a costly scan, darker the larger this scan's share of all rows read by
// the plan's scans. Lightness runs from 98% (a negligible share — barely tinted) down to 82% (the scan
// that read essentially everything); both ends are kept light so even the heaviest reads as a soft
// heatmap red, not a saturated error color. `processedTotal` is the summed processed-rows across every
// scan; when it is non-positive (no runtime stats) there is nothing to scale against, so fall back to
// the lightest shade. Shared by the loader (bake) and `deriveNodeDisplay` so the two never diverge.
export function costlyScanShade(processedRows: number, processedTotal: number): string {
    const ratio = processedTotal > 0 ? processedRows / processedTotal : 0;
    return heatShade(0, 100, 98, 82, ratio);
}

// The proportional violet shade for a runtime (CPU) hotspot, darker the larger this operator's share of
// the plan's total CPU cycles. A distinct hue from the magenta cardinality-misestimate edge highlight,
// so the two rules never read alike. Shared by the loader (`colorRelativeExecutionTime`) and
// `deriveNodeDisplay` so the bake and render-time recompute stay in step.
export function runtimeHotspotShade(ratio: number): string {
    return heatShade(265, 70, 95, 72, ratio);
}

// The proportional orange shade for a memory hotspot, darker the larger this operator's share of the
// plan's total peak memory (the memory analog of the violet CPU heatmap). Orange (hue 28) is the one
// open "warning heat" slot in the palette, disambiguated by the legend, the tinted `memory-bytes` row,
// and the hover tooltip. Shared by the loader (`colorRelativeMemory`) and `deriveNodeDisplay`.
export function memoryHotspotShade(ratio: number): string {
    return heatShade(28, 90, 95, 72, ratio);
}

// The hover-tooltip reason for a node whose output projects a duplicate column name. Built in one place
// because two code paths emit it: the loader bakes it at load time, and `deriveNodeDisplay` re-appends it
// on adjustable plans (where it rebuilds `highlightReason` from scratch).
export function duplicateColumnsReason(names: string[]): string {
    return `Duplicate output column name${names.length > 1 ? "s" : ""}: ${names.join(", ")}.`;
}

// The subset of `TreeNode` fields recomputed from thresholds. Merged onto the node's render data.
export interface NodeDisplay {
    highlightNode?: "costly-scan" | "high-volume-scan" | "index-rec" | "index-used";
    highlightReason?: string;
    costlyScan?: boolean;
    costlyScanColor?: string;
    highVolumeScan?: boolean;
    nodeColor?: string;
    memoryColor?: string;
    edgeClass?: string;
    edgeReason?: string;
}

// Recompute a node's threshold-dependent display from its raw signals. This is the render-time
// counterpart of the loader: it reproduces exactly what the loader used to bake, but reads the
// live thresholds so edits re-highlight without reloading the plan.
//
// Precedence for the node color is costly-scan > high-volume-scan > index-rec > index-used; the runtime-hotspot tint
// is orthogonal (it colors the node label / cpu-cycles row) and its explanation is appended to any
// existing reason. On the edge, a costly scan's reason overrides a cardinality misestimate's.
export function deriveNodeDisplay(
    node: TreeNode,
    t: HighlightThresholds,
    planCpuTotal: number,
    planProcessedTotal: number,
    planMemoryTotal: number,
): NodeDisplay {
    const display: NodeDisplay = {};

    // Costly scan (top-precedence node color).
    const costly =
        typeof node.scanProcessedRows === "number" &&
        typeof node.scanRowsMatching === "number" &&
        isCostlyScan(node.scanProcessedRows, node.scanRowsMatching, t);
    let costlyReason: string | undefined;
    if (costly) {
        costlyReason = costlyScanReason(node.scanProcessedRows!, node.scanRowsMatching!);
        display.highlightNode = "costly-scan";
        display.highlightReason = costlyReason;
        display.costlyScan = true;
        // Shade the node box proportionally to this scan's share of all rows the plan's scans read,
        // the same heatmap the loader bakes (see `shadeCostlyScans` in hyper.ts).
        display.costlyScanColor = costlyScanShade(node.scanProcessedRows!, planProcessedTotal);
    } else if (typeof node.scanProcessedRows === "number" && isHighVolumeScan(node.scanProcessedRows, t)) {
        // High-volume scan: less severe than a costly scan (so it only claims the node when the scan
        // isn't costly), but more prominent than the index categories, so it wins the fill over them.
        // An index recommendation on the same scan still shows on the border (see `qg-node-index-rec-border`).
        display.highlightNode = "high-volume-scan";
        display.highlightReason = highVolumeScanReason(node.scanProcessedRows);
        display.highVolumeScan = true;
    } else if (node.baseHighlight) {
        // Fall back to the non-threshold node category (index recommendation or index used).
        display.highlightNode = node.baseHighlight;
        display.highlightReason = node.baseHighlightReason;
    }

    // Cardinality on the incoming edge. The edge label shows only the bare "actual/estimate" numbers,
    // so always spell them out as a hover tooltip; when they diverge sharply, highlight the edge and
    // append the misestimate explanation below the counts.
    if (typeof node.cardEstimate === "number" && typeof node.cardActual === "number") {
        const rowsTip = `Actual rows: ${formatMetric(node.cardActual)}, Est. rows: ${formatMetric(node.cardEstimate)}`;
        display.edgeReason = rowsTip;
        if (isCardinalityMismatch(node.cardEstimate, node.cardActual, t)) {
            display.edgeClass = "qg-label-highlighted";
            const dir = node.cardEstimate > node.cardActual ? "over-estimated" : "under-estimated";
            // Scans report the matched-restrictions count as their "actual"; generic operators report
            // measured output. Word the two cases accordingly.
            const tail = node.cardIsScan
                ? `estimated ${formatMetric(node.cardEstimate)} rows, ${formatMetric(node.cardActual)} matched the restrictions.`
                : `estimated ${formatMetric(node.cardEstimate)} rows, actual ${formatMetric(node.cardActual)}.`;
            const subject = node.cardIsScan ? "this scan's output" : "this operator's output";
            display.edgeReason = `${rowsTip}\nCardinality misestimate: the optimizer ${dir} ${subject} — ${tail}`;
        }
    }
    // A costly scan always highlights the edge; append its reason below any row-count/misestimate text.
    if (costly) {
        display.edgeClass = "qg-label-highlighted";
        display.edgeReason = display.edgeReason ? `${display.edgeReason}\n${costlyReason}` : costlyReason;
    }

    // Runtime hotspot (orthogonal violet tint on the node label / cpu-cycles row). A distinct hue
    // from the magenta cardinality-misestimate edge highlight, so the two rules never read alike.
    if (typeof node.cpuTime === "number" && planCpuTotal > 0) {
        const ratio = node.cpuTime / planCpuTotal;
        if (ratio >= t.runtimeHotspotPercent / 100) {
            display.nodeColor = runtimeHotspotShade(ratio);
            const pct = Math.round(ratio * 100);
            const cpuReason = runtimeHotspotReason(node.cpuTime, pct);
            // Each reason on its own line so multiple findings on one node stay legible.
            display.highlightReason = display.highlightReason ? `${display.highlightReason}\n${cpuReason}` : cpuReason;
            // Only append to a *highlighted* edge (mismatch / costly), not to the plain row-count
            // tooltip that every cardinality edge now carries — otherwise the CPU note would leak onto
            // ordinary edges. Gate on `edgeClass` rather than the (now always-set) `edgeReason`.
            if (display.edgeClass) display.edgeReason = `${display.edgeReason}\n${cpuReason}`;
        }
    }

    // Memory hotspot (orthogonal orange tint on the node label / memory-bytes row). Independent of the
    // CPU hotspot — an operator can be both — so it gets its own `memoryColor`; the label shows the CPU
    // tint first (see QueryNode.tsx) but the memory-bytes row always carries this color. Keep the shade
    // and reason string in sync with `colorRelativeMemory` in hyper.ts.
    if (typeof node.memoryBytes === "number" && planMemoryTotal > 0) {
        const ratio = node.memoryBytes / planMemoryTotal;
        if (ratio >= t.memoryHotspotPercent / 100) {
            display.memoryColor = memoryHotspotShade(ratio);
            const pct = Math.round(ratio * 100);
            const memReason = memoryHotspotReason(node.memoryBytes, pct);
            display.highlightReason = display.highlightReason ? `${display.highlightReason}\n${memReason}` : memReason;
            if (display.edgeClass) display.edgeReason = `${display.edgeReason}\n${memReason}`;
        }
    }

    // Duplicate output column names — a static per-plan fact (not threshold-dependent), baked by the
    // loader. Re-append it here so the node's hover tooltip keeps the flag on adjustable plans, where
    // this function rebuilds `highlightReason` from scratch.
    if (node.duplicateColumns && node.duplicateColumns.length > 0) {
        const dupReason = duplicateColumnsReason(node.duplicateColumns);
        display.highlightReason = display.highlightReason ? `${display.highlightReason}\n${dupReason}` : dupReason;
    }

    return display;
}
