import {useMemo, useState, useCallback, useRef, useEffect} from "react";
import type {ReactElement, ReactNode} from "react";
import {Panel, useReactFlow} from "@xyflow/react";
import type {TreeDescription, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import {formatMetric, formatBytes} from "../loaders/loader-utils";
import {useGraphRenderingStore} from "./store";
import {HIGHLIGHT_RULES, isCostlyScan, isHighVolumeScan} from "../highlight-rules";
import type {QueryGraphNode} from "./QueryNode";
import "./PlanInsights.css";

// The highlight categories, in the same precedence order used by the loaders, with the
// human-readable labels shown in the legend and summary.
const CATEGORIES = [
    {key: "costly-scan", label: "Inefficient scan"},
    {key: "high-volume-scan", label: "High-volume scan"},
    {key: "index-rec", label: "Index recommendation"},
    {key: "duplicate-columns", label: "Duplicate output columns"},
    {key: "index-used", label: "Index used"},
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

// The ranked "Top …" lists start compact, showing this many rows, and reveal `ROWS_STEP` more each time
// the trailing "…" control is clicked (walking the full list a batch at a time).
const INITIAL_ROWS = 3;
const ROWS_STEP = 2;

// Longest offender label to render inline; longer names are trimmed with an ellipsis (the full name
// stays in the hover tooltip).
const OFFENDER_LABEL_MAX = 30;
function trimLabel(label: string): string {
    return label.length > OFFENDER_LABEL_MAX ? label.slice(0, OFFENDER_LABEL_MAX - 1).trimEnd() + "…" : label;
}

// A scan ranked in the "top offenders" list, worst-first by processed-row volume.
interface Offender {
    id: string;
    label: string;
    processed: number;
    matching?: number;
    costlyScan: boolean;
}

// An operator ranked in the "top operators by CPU" list, worst-first by CPU cycles consumed.
interface CpuOp {
    id: string;
    label: string;
    cycles: number;
}

// An operator ranked in the "top operators by memory" list, worst-first by peak memory held.
interface MemoryOp {
    id: string;
    label: string;
    bytes: number;
}

// A vector / hybrid search node (e.g. Data Cloud `hybrid_search`), called out so the user can spot
// and jump to it. `label` is the index searched (falling back to the function name).
interface SearchNode {
    id: string;
    label: string;
    detail: string;
    hybrid: boolean;
}

// An operator that carries a runtime error (a failed / analyzed plan). `message` is the one-line error
// (SQLSTATE-prefixed); `label` names the operator so the user can tell where it was raised.
interface PlanError {
    id: string;
    label: string;
    message: string;
}

interface PlanInsightsProps {
    treeDescription: TreeDescription;
    // Maps each tree node to the id react-flow assigns it, so we can pan to it.
    nodeIdMapping: Map<TreeNode, string>;
}

// One row of a ranked "Top …" list: a clickable operator with a formatted metric and hover tooltip.
// `hot` applies the list's accent tint (a costly scan / CPU / memory hotspot).
interface RankedRow {
    id: string;
    label: string;
    metric: string;
    hot: boolean;
    title: string;
}

// A ranked "Top …" list (top scans / CPU / memory): a titled column of clickable rows, each showing a
// rank, trimmed label, and formatted metric, ending with an optional more/less control. The three lists
// differ only in their data, accent color, and metric formatter, so they share this one renderer. The
// `hotClass` is added to a "hot" row so its metric picks up the matching node-highlight tint (see the
// `.qg-insights-metric-*` rules in PlanInsights.css).
function RankedList({
    title,
    rows,
    hotClass,
    onSelect,
    controls,
}: {
    title: string;
    rows: RankedRow[];
    hotClass: string;
    onSelect: (id: string) => void;
    controls: ReactNode;
}): ReactElement {
    return (
        <div className="qg-insights-list">
            <div className="qg-insights-list-title">{title}</div>
            {rows.map((r, i) => (
                <button
                    key={r.id}
                    type="button"
                    className={`qg-insights-list-row${r.hot ? ` ${hotClass}` : ""}`}
                    onClick={() => onSelect(r.id)}
                    title={r.title}
                >
                    <span className="qg-insights-list-rank">{i + 1}.</span>
                    <span className="qg-insights-list-label">{trimLabel(r.label)}</span>
                    <span className="qg-insights-list-metric">{r.metric}</span>
                </button>
            ))}
            {controls}
        </div>
    );
}

// An overlay panel providing at-a-glance plan insights: a color legend, a one-line summary of
// the issues found, a "jump to next issue" navigator, and a focus toggle that dims all
// non-flagged nodes so the interesting ones stand out on large plans.
export function PlanInsights({treeDescription, nodeIdMapping}: PlanInsightsProps) {
    const reactFlow = useReactFlow<QueryGraphNode>();

    // Live thresholds behind the highlight rules. Editing one re-highlights the graph and updates the
    // counts/offenders below without reloading the plan.
    const thresholds = useGraphRenderingStore((s) => s.highlightThresholds);
    const setThreshold = useGraphRenderingStore((s) => s.setThreshold);
    const resetThresholds = useGraphRenderingStore((s) => s.resetThresholds);
    // The footer's threshold editor is only meaningful for plans that support adjustable highlighting.
    const adjustable = !!treeDescription.adjustableHighlights;

    // A scan's "costly" verdict is threshold-dependent, so recompute it here (for adjustable plans)
    // rather than trusting the loader's baked flag — otherwise the legend counts and offender
    // highlighting would ignore live threshold edits.
    const costlyOf = useCallback(
        (n: TreeNode): boolean => {
            if (!adjustable) return !!n.costlyScan;
            if (typeof n.scanProcessedRows !== "number" || typeof n.scanRowsMatching !== "number") return false;
            return isCostlyScan(n.scanProcessedRows, n.scanRowsMatching, thresholds);
        },
        [adjustable, thresholds],
    );

    // Likewise recompute a scan's "high volume" verdict from the live threshold, so the legend count,
    // node highlight, and offenders match after a threshold edit. Independent of "costly" — a scan can
    // be one, both, or neither.
    const highVolumeOf = useCallback(
        (n: TreeNode): boolean => {
            if (typeof n.scanProcessedRows !== "number") return false;
            if (!adjustable) return !!n.highVolumeScan;
            return isHighVolumeScan(n.scanProcessedRows, thresholds);
        },
        [adjustable, thresholds],
    );

    // Walk the tree once, grouping node ids by category and totaling the scan volume. A node can
    // belong to several categories at once — a costly scan may also carry an index recommendation
    // and use an index — so membership is read from the per-category flags rather than the single
    // `highlightNode` display color (which can only reflect one category by precedence). This keeps
    // the legend counts honest: an index-rec on a costly scan still counts under "index-rec".
    const {byCategory, totalProcessed, scans, searchNodes, scanTypes, cpus, totalCpu, mems, totalMemory, errors} = useMemo(() => {
        const byCategory: Record<CategoryKey, string[]> = {
            "costly-scan": [],
            "high-volume-scan": [],
            "index-rec": [],
            "duplicate-columns": [],
            "index-used": [],
        };
        let totalProcessed = 0;
        let totalCpu = 0;
        let totalMemory = 0;
        const scans: Offender[] = [];
        const cpus: CpuOp[] = [];
        const mems: MemoryOp[] = [];
        const searchNodes: SearchNode[] = [];
        const errors: PlanError[] = [];
        // Group scan-node ids by their source type (`data-lake-object`, `tablescan`, …) for the
        // "Scan types" breakdown; the count is the list length and the ids drive click-to-drill.
        const scanTypeIds = new Map<string, string[]>();
        visitTreeNodes(
            treeDescription.root,
            (n) => {
                if (typeof n.scanProcessedRows === "number") {
                    totalProcessed += n.scanProcessedRows;
                }
                if (typeof n.cpuTime === "number") {
                    totalCpu += n.cpuTime;
                }
                if (typeof n.memoryBytes === "number") {
                    totalMemory += n.memoryBytes;
                }
                const id = nodeIdMapping.get(n);
                if (id === undefined) return;
                // Label an operator by its name, tagging the operator-id when present so two same-named
                // operators stay distinguishable. Shared by the error / CPU / memory lists below.
                const opId = n.properties?.get("operator-id");
                const opLabel = opId ? `${n.name ?? "operator"} #${opId}` : (n.name ?? "operator");
                // A runtime error is the single most important finding: collect the errored operator(s)
                // so the panel can call it out as a severe error and link straight to the node.
                if (n.errorMessage) {
                    errors.push({id, label: opLabel, message: n.errorMessage});
                }
                // Every operator with a measured CPU figure is a CPU-list candidate.
                if (typeof n.cpuTime === "number") {
                    cpus.push({id, label: opLabel, cycles: n.cpuTime});
                }
                // Every operator with a measured peak-memory figure is a memory-list candidate.
                if (typeof n.memoryBytes === "number") {
                    mems.push({id, label: opLabel, bytes: n.memoryBytes});
                }
                if (n.scanType) {
                    const ids = scanTypeIds.get(n.scanType);
                    if (ids) ids.push(id);
                    else scanTypeIds.set(n.scanType, [id]);
                }
                const costly = costlyOf(n);
                if (costly) byCategory["costly-scan"].push(id);
                if (highVolumeOf(n)) byCategory["high-volume-scan"].push(id);
                if (n.hasIndexRec) byCategory["index-rec"].push(id);
                if (n.duplicateColumns?.length) byCategory["duplicate-columns"].push(id);
                if (n.hasIndexUsed) byCategory["index-used"].push(id);
                // Every scan with a measured processed-row volume is an offender candidate.
                if (typeof n.scanProcessedRows === "number") {
                    const matching = n.scanRowsMatching;
                    scans.push({
                        id,
                        label: n.properties?.get("table-name") ?? n.name ?? "scan",
                        processed: n.scanProcessedRows,
                        matching,
                        costlyScan: costly,
                    });
                }
                // A vector / hybrid search node (Data Cloud `hybrid_search` etc.).
                if (n.vectorSearch) {
                    const vs = n.vectorSearch;
                    // Prefer the index searched as the primary label; the vector DB + embedding model
                    // make the informative detail line.
                    const detailParts = [vs.vectorDb, vs.embeddingModel].filter((p): p is string => !!p);
                    searchNodes.push({
                        id,
                        label: vs.index ?? vs.function ?? n.name ?? "search",
                        detail: detailParts.join(" · "),
                        hybrid: !!vs.hybrid,
                    });
                }
            },
            allChildren,
        );
        // Rank worst-first by raw processed volume — the rows Hyper actually had to read. The full
        // sorted list is returned; the render shows the first few and reveals more on demand.
        scans.sort((a, b) => b.processed - a.processed);
        // Rank CPU / memory operators worst-first (cycles consumed / peak memory held). The full sorted
        // lists are returned: the render shows the top-N, but also needs to flag every operator that
        // clears the live hotspot threshold (which can extend past the top-N) for the summary and
        // "Next issue" navigation.
        cpus.sort((a, b) => b.cycles - a.cycles);
        mems.sort((a, b) => b.bytes - a.bytes);
        // Most-frequent type first; ties broken alphabetically for a stable order.
        const scanTypes = [...scanTypeIds.entries()]
            .map(([type, ids]) => ({type, ids}))
            .sort((a, b) => b.ids.length - a.ids.length || a.type.localeCompare(b.type));
        return {byCategory, totalProcessed, scans, searchNodes, scanTypes, cpus, totalCpu, mems, totalMemory, errors};
    }, [treeDescription, nodeIdMapping, costlyOf, highVolumeOf]);

    const counts: Record<CategoryKey, number> = {
        "costly-scan": byCategory["costly-scan"].length,
        "high-volume-scan": byCategory["high-volume-scan"].length,
        "index-rec": byCategory["index-rec"].length,
        "duplicate-columns": byCategory["duplicate-columns"].length,
        "index-used": byCategory["index-used"].length,
    };

    // The ranked lists show the top-N; separately, every operator that clears the live hotspot
    // threshold is collected (from the full sorted lists, so it isn't capped at the visible top-N).
    // These hotspot id sets feed the summary verdict and "Next issue" navigation, and are recomputed
    // here at render time so they track live threshold edits — matching the per-row hotspot flags in
    // the ranked lists below.
    // Memoized so each keeps a stable identity across renders (`cpus`/`mems`/`totalCpu`/`totalMemory`
    // come from the memo above; only a live threshold edit changes the result). This matters because
    // the `issues` memo below depends on these arrays — recreating them every render would defeat its
    // memoization and make "Next issue" navigation churn.
    const cpuHotspotIds = useMemo(
        () =>
            totalCpu > 0 ? cpus.filter((c) => c.cycles / totalCpu >= thresholds.runtimeHotspotPercent / 100).map((c) => c.id) : [],
        [cpus, totalCpu, thresholds.runtimeHotspotPercent],
    );
    const memoryHotspotIds = useMemo(
        () =>
            totalMemory > 0
                ? mems.filter((m) => m.bytes / totalMemory >= thresholds.memoryHotspotPercent / 100).map((m) => m.id)
                : [],
        [mems, totalMemory, thresholds.memoryHotspotPercent],
    );

    // Center a node in the viewport by react-flow id.
    const centerOnNode = useCallback(
        (id: string) => {
            const target = reactFlow.getNode(id);
            if (target) {
                // The graph sets `nodeOrigin={[0.5, 0]}`, so a node's `position` anchor is its
                // top-center: `position.x` is already the horizontal center (no +width/2), while
                // `position.y` is the top edge, so add half the height to reach the vertical center.
                const x = target.position.x;
                const y = target.position.y + (target.measured?.height ?? target.height ?? 0) / 2;
                reactFlow.setCenter(x, y, {zoom: 1, duration: 400});
            }
        },
        [reactFlow],
    );

    // Each category keeps its own round-robin cursor, so repeatedly clicking a legend row (or the
    // "Next issue" button) walks through that category's nodes one at a time.
    const cursorsRef = useRef<Record<string, number>>({});
    const drillInto = useCallback(
        (ids: string[], key: string) => {
            if (ids.length === 0) return;
            const next = ((cursorsRef.current[key] ?? -1) + 1) % ids.length;
            cursorsRef.current[key] = next;
            centerOnNode(ids[next]);
        },
        [centerOnNode],
    );

    // "Jump to next issue" cycles through the actual issues — costly scans, index recommendations,
    // duplicate output columns, and runtime / memory hotspots — centering each in the viewport. A used
    // index is good, not a problem, so it is not part of the navigation even though it is counted in the
    // legend. A node can fall into several of these at once (e.g. a costly scan that is also a CPU
    // hotspot), so the union is deduplicated to avoid visiting it twice.
    const issues = useMemo(
        () => [
            ...new Set([
                ...byCategory["costly-scan"],
                ...byCategory["high-volume-scan"],
                ...byCategory["index-rec"],
                ...byCategory["duplicate-columns"],
                ...cpuHotspotIds,
                ...memoryHotspotIds,
            ]),
        ],
        [byCategory, cpuHotspotIds, memoryHotspotIds],
    );
    const [cursor, setCursor] = useState(-1);
    // Reset every navigation cursor when a different plan is loaded, so drill-down and "next issue"
    // start fresh instead of resuming at a position that referred to the previous plan's node list.
    // The `cursor` state uses React's render-phase "adjust state when a prop changes" pattern (tracking
    // the previous plan) rather than a `setState` inside an effect; the `cursorsRef` map is a plain ref,
    // so it is cleared in an effect (refs must not be written during render).
    const [prevTree, setPrevTree] = useState(treeDescription);
    // How many rows each "Top …" list currently reveals. Starts compact; the trailing "…" grows it.
    const [scansShown, setScansShown] = useState(INITIAL_ROWS);
    const [cpuShown, setCpuShown] = useState(INITIAL_ROWS);
    const [memShown, setMemShown] = useState(INITIAL_ROWS);
    if (prevTree !== treeDescription) {
        setPrevTree(treeDescription);
        setCursor(-1);
        // A new plan has different lists; collapse each back to the compact initial size.
        setScansShown(INITIAL_ROWS);
        setCpuShown(INITIAL_ROWS);
        setMemShown(INITIAL_ROWS);
    }
    const offenders = scans.slice(0, scansShown);
    const cpuOps = cpus.slice(0, cpuShown);
    const memoryOps = mems.slice(0, memShown);

    // The "… N more / … N less" controls for a ranked list: reveal the next `ROWS_STEP` entries, or
    // collapse back toward the compact `INITIAL_ROWS`. Rendered only for the directions that apply, so a
    // list capped at its full length shows just "less", and one at the initial size shows just "more".
    const revealControls = (shown: number, setShown: (u: (s: number) => number) => void, total: number) => {
        const more = Math.min(ROWS_STEP, total - shown);
        const less = Math.min(ROWS_STEP, shown - INITIAL_ROWS);
        if (more <= 0 && less <= 0) return null;
        return (
            <div className="qg-insights-more-row">
                {more > 0 ? (
                    <button
                        type="button"
                        className="qg-insights-more"
                        onClick={() => setShown((s) => Math.min(total, s + ROWS_STEP))}
                        title={`Show ${more} more (${total - shown} hidden)`}
                    >
                        more
                    </button>
                ) : null}
                {less > 0 ? (
                    <button
                        type="button"
                        className="qg-insights-more"
                        onClick={() => setShown((s) => Math.max(INITIAL_ROWS, s - ROWS_STEP))}
                        title={`Show ${less} fewer`}
                    >
                        less
                    </button>
                ) : null}
            </div>
        );
    };
    useEffect(() => {
        cursorsRef.current = {};
    }, [treeDescription]);
    const jumpToNext = useCallback(() => {
        if (issues.length === 0) return;
        const next = (cursor + 1) % issues.length;
        setCursor(next);
        centerOnNode(issues[next]);
    }, [issues, cursor, centerOnNode]);

    // Focus mode dims every non-flagged node so the flagged ones pop on a large plan. The dimming
    // is applied during layout (see tree-layout.ts), driven by this store flag.
    const focus = useGraphRenderingStore((s) => s.focusIssues);
    const setFocusIssues = useGraphRenderingStore((s) => s.setFocusIssues);
    const toggleFocus = useCallback(() => setFocusIssues(!focus), [focus, setFocusIssues]);

    // The rules footer documents each highlight rule and (for adjustable plans) lets the user tune its
    // thresholds; it starts collapsed to keep the panel compact.
    const [rulesOpen, setRulesOpen] = useState(false);

    // The whole tools panel can be minimized to a compact header bar, to get it out of the way on
    // small viewports or when the user just wants to see the graph. Starts expanded.
    const [minimized, setMinimized] = useState(false);

    const totalIssues =
        counts["costly-scan"] +
        counts["high-volume-scan"] +
        counts["index-rec"] +
        counts["duplicate-columns"] +
        cpuHotspotIds.length +
        memoryHotspotIds.length;
    // Single header line: only actionable findings (costly scans, index recommendations, duplicate
    // output columns, and runtime / memory hotspots) plus the total scan volume. "Index used" is
    // informational, not actionable, so it stays in the legend and node colors but is deliberately kept
    // out of the header summary.
    const summaryParts: string[] = [];
    if (counts["costly-scan"])
        summaryParts.push(`${counts["costly-scan"]} inefficient scan${counts["costly-scan"] > 1 ? "s" : ""}`);
    if (counts["high-volume-scan"])
        summaryParts.push(`${counts["high-volume-scan"]} high-volume scan${counts["high-volume-scan"] > 1 ? "s" : ""}`);
    if (counts["index-rec"]) summaryParts.push(`${counts["index-rec"]} index recommendation${counts["index-rec"] > 1 ? "s" : ""}`);
    if (counts["duplicate-columns"])
        summaryParts.push(`${counts["duplicate-columns"]} duplicate-column node${counts["duplicate-columns"] > 1 ? "s" : ""}`);
    if (cpuHotspotIds.length) summaryParts.push(`${cpuHotspotIds.length} CPU hotspot${cpuHotspotIds.length > 1 ? "s" : ""}`);
    if (memoryHotspotIds.length)
        summaryParts.push(`${memoryHotspotIds.length} memory hotspot${memoryHotspotIds.length > 1 ? "s" : ""}`);
    if (totalProcessed > 0) summaryParts.push(`${formatMetric(totalProcessed)} rows processed`);
    // A hybrid/vector search node is a notable plan characteristic (not an issue), so it is mentioned
    // in the summary but does not flip the verdict to "warn".
    if (searchNodes.length) {
        // Hybrid and pure-vector searches can coexist in one plan; label each group by its own count
        // rather than calling the whole set "hybrid" whenever a single node is (which mislabels the
        // pure-vector ones). Uses "search"/"searches" per group so "1 hybrid search" reads correctly.
        const hybridCount = searchNodes.filter((s) => s.hybrid).length;
        const vectorCount = searchNodes.length - hybridCount;
        const label = (n: number, kind: string) => `${n} ${kind} search${n > 1 ? "es" : ""}`;
        if (hybridCount) summaryParts.push(label(hybridCount, "hybrid"));
        if (vectorCount) summaryParts.push(label(vectorCount, "vector"));
    }
    const summary = summaryParts.length ? summaryParts.join(", ") : "No issues detected";

    return (
        <>
            {/* Summary sits on the top row, centered (same line as the title box). A query failure
                outranks every other finding, so it replaces the summary with a clickable severe banner
                that jumps to the failed operator. */}
            <Panel position="top-center" className="qg-insights qg-insights-summary-panel">
                {errors.length > 0 ? (
                    <button
                        type="button"
                        className="qg-insights-summary qg-insights-verdict-error"
                        onClick={() => centerOnNode(errors[0].id)}
                        title={`${errors[0].label}: ${errors[0].message}\nClick to jump to the failed operator.`}
                    >
                        ⚠ Query failed — {errors[0].message}
                    </button>
                ) : (
                    <span className={`qg-insights-summary ${totalIssues ? "qg-insights-verdict-warn" : "qg-insights-verdict-ok"}`}>
                        {summary}
                    </span>
                )}
            </Panel>
            {/* Legend + navigation stay in the top-right corner. */}
            <Panel
                position="top-right"
                className={`qg-insights qg-insights-tools-panel${minimized ? " qg-insights-minimized" : ""}`}
            >
                <div className="qg-insights-tools-header">
                    <span className="qg-insights-tools-title">Plan insights</span>
                    <button
                        type="button"
                        className="qg-insights-minimize"
                        onClick={() => setMinimized((m) => !m)}
                        aria-expanded={!minimized}
                        title={minimized ? "Expand plan insights" : "Minimize plan insights"}
                    >
                        {minimized ? "+" : "–"}
                    </button>
                </div>
                {minimized ? null : (
                    <>
                        {errors.length > 0 ? (
                            <div className="qg-insights-errors">
                                <div className="qg-insights-errors-title">Query error{errors.length > 1 ? "s" : ""}</div>
                                {errors.map((e) => (
                                    <button
                                        key={e.id}
                                        type="button"
                                        className="qg-insights-error"
                                        onClick={() => centerOnNode(e.id)}
                                        title={`${e.label}: ${e.message}\nClick to jump to the failed operator.`}
                                    >
                                        <span className="qg-insights-error-label">{trimLabel(e.label)}</span>
                                        <span className="qg-insights-error-message">{e.message}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        {/* Only categories present in this plan are listed — a zero-count row is just noise. */}
                        <div className="qg-insights-legend">
                            {CATEGORIES.filter((c) => counts[c.key] > 0).map((c) => (
                                <button
                                    key={c.key}
                                    type="button"
                                    className="qg-insights-legend-item"
                                    onClick={() => drillInto(byCategory[c.key], c.key)}
                                    title={`Click to drill into ${c.label.toLowerCase()} nodes`}
                                >
                                    <span className={`qg-insights-swatch qg-swatch-${c.key}`} />
                                    {c.label}
                                    <span className="qg-insights-count">({counts[c.key]})</span>
                                </button>
                            ))}
                        </div>
                        {scans.length > 0 ? (
                            <RankedList
                                title="Top scans by rows processed"
                                hotClass="qg-insights-metric-costly"
                                onSelect={centerOnNode}
                                controls={revealControls(scansShown, setScansShown, scans.length)}
                                rows={offenders.map((o) => ({
                                    id: o.id,
                                    label: o.label,
                                    metric: formatMetric(o.processed),
                                    hot: o.costlyScan,
                                    title:
                                        `Scan of ${o.label}: processed ${formatMetric(o.processed)} rows` +
                                        (typeof o.matching === "number"
                                            ? `, ${formatMetric(o.matching)} matched restrictions`
                                            : "") +
                                        ". Click to jump.",
                                }))}
                            />
                        ) : null}
                        {cpus.length > 0 ? (
                            <RankedList
                                title="Top operators by CPU"
                                hotClass="qg-insights-metric-cpu"
                                onSelect={centerOnNode}
                                controls={revealControls(cpuShown, setCpuShown, cpus.length)}
                                rows={cpuOps.map((c) => {
                                    const share = totalCpu > 0 ? c.cycles / totalCpu : 0;
                                    return {
                                        id: c.id,
                                        label: c.label,
                                        metric: formatMetric(c.cycles),
                                        // Flag operators clearing the live runtime-hotspot threshold, so the
                                        // list agrees with the violet node tint under the current settings.
                                        hot: share >= thresholds.runtimeHotspotPercent / 100,
                                        title:
                                            `${c.label}: used ${formatMetric(c.cycles)} CPU cycles` +
                                            (totalCpu > 0 ? ` — ${Math.round(share * 100)}% of the plan's total runtime` : "") +
                                            ". Click to jump.",
                                    };
                                })}
                            />
                        ) : null}
                        {mems.length > 0 ? (
                            <RankedList
                                title="Top operators by memory"
                                hotClass="qg-insights-metric-mem"
                                onSelect={centerOnNode}
                                controls={revealControls(memShown, setMemShown, mems.length)}
                                rows={memoryOps.map((m) => {
                                    const share = totalMemory > 0 ? m.bytes / totalMemory : 0;
                                    return {
                                        id: m.id,
                                        label: m.label,
                                        metric: formatBytes(m.bytes),
                                        // Flag operators clearing the live memory-hotspot threshold, so the
                                        // list agrees with the orange node tint under the current settings.
                                        hot: share >= thresholds.memoryHotspotPercent / 100,
                                        title:
                                            `${m.label}: held ${formatBytes(m.bytes)}` +
                                            (totalMemory > 0 ? ` — ${Math.round(share * 100)}% of the plan's peak memory` : "") +
                                            ". Click to jump.",
                                    };
                                })}
                            />
                        ) : null}
                        {scanTypes.length > 0 ? (
                            <div className="qg-insights-list">
                                <div className="qg-insights-list-title">Scan types</div>
                                {scanTypes.map((s) => (
                                    <button
                                        key={s.type}
                                        type="button"
                                        className="qg-insights-list-row"
                                        onClick={() => drillInto(s.ids, `scantype:${s.type}`)}
                                        title={`${s.ids.length} ${s.type} scan${s.ids.length > 1 ? "s" : ""}. Click to jump${s.ids.length > 1 ? " (cycles through them)" : ""}.`}
                                    >
                                        <span className="qg-insights-list-label">{s.type}</span>
                                        <span className="qg-insights-list-metric">{s.ids.length}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        {searchNodes.length > 0 ? (
                            <div className="qg-insights-list">
                                <div className="qg-insights-list-title qg-insights-search-title">
                                    {searchNodes.some((s) => s.hybrid) ? "Hybrid / vector search" : "Vector search"}
                                </div>
                                {searchNodes.map((s) => (
                                    <button
                                        key={s.id}
                                        type="button"
                                        className="qg-insights-list-row qg-insights-search-item"
                                        onClick={() => centerOnNode(s.id)}
                                        title={
                                            `${s.hybrid ? "Hybrid" : "Vector"} search on ${s.label}` +
                                            (s.detail ? ` (${s.detail})` : "") +
                                            ". Click to jump."
                                        }
                                    >
                                        <span className="qg-insights-search-badge">{s.hybrid ? "hybrid" : "vector"}</span>
                                        <span className="qg-insights-search-label">{trimLabel(s.label)}</span>
                                        {s.detail ? <span className="qg-insights-search-detail">{s.detail}</span> : null}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        {issues.length > 0 ? (
                            <div className="qg-insights-actions">
                                <button type="button" onClick={jumpToNext}>
                                    Next issue{" "}
                                    {cursor >= 0 ? `(${(cursor % issues.length) + 1}/${issues.length})` : `(${issues.length})`}
                                </button>
                                <button type="button" onClick={toggleFocus} className={focus ? "qg-active" : undefined}>
                                    {focus ? "Show all" : "Focus issues"}
                                </button>
                            </div>
                        ) : null}
                        {/* Footer: what each highlight means, and (for adjustable plans) editable thresholds. */}
                        <div className="qg-insights-rules">
                            <button
                                type="button"
                                className="qg-insights-rules-toggle"
                                onClick={() => setRulesOpen((o) => !o)}
                                aria-expanded={rulesOpen}
                            >
                                <span className={`qg-insights-rules-caret${rulesOpen ? " qg-open" : ""}`}>▸</span>
                                How highlighting works
                            </button>
                            {rulesOpen ? (
                                <div className="qg-insights-rules-body">
                                    {HIGHLIGHT_RULES.map((rule) => (
                                        <div key={rule.key} className="qg-insights-rule">
                                            <div className="qg-insights-rule-head">
                                                <span className={`qg-insights-swatch ${rule.swatchClass}`} />
                                                <span className="qg-insights-rule-label">{rule.label}</span>
                                            </div>
                                            <div className="qg-insights-rule-desc">{rule.description}</div>
                                            {adjustable && rule.fields.length > 0 ? (
                                                <div className="qg-insights-rule-fields">
                                                    {rule.fields.map((f) => (
                                                        <label key={f.key} className="qg-insights-rule-field">
                                                            <span className="qg-insights-rule-field-label">{f.label}</span>
                                                            <span className="qg-insights-rule-field-input">
                                                                <input
                                                                    type="text"
                                                                    inputMode="numeric"
                                                                    // A text input (not type=number) so the value can render
                                                                    // with thousands separators; commas are stripped on parse.
                                                                    value={thresholds[f.key].toLocaleString("en-US")}
                                                                    onChange={(e) => {
                                                                        const v = Number(e.target.value.replace(/,/g, ""));
                                                                        // Ignore an empty/invalid field (NaN) so the plan
                                                                        // isn't re-highlighted mid-edit; clamp to the min.
                                                                        if (Number.isNaN(v)) return;
                                                                        setThreshold(f.key, Math.max(f.min, v));
                                                                    }}
                                                                />
                                                                {f.unit ? (
                                                                    <span className="qg-insights-rule-field-unit">{f.unit}</span>
                                                                ) : null}
                                                            </span>
                                                        </label>
                                                    ))}
                                                </div>
                                            ) : null}
                                        </div>
                                    ))}
                                    {adjustable ? (
                                        <button type="button" className="qg-insights-rules-reset" onClick={resetThresholds}>
                                            Reset to defaults
                                        </button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </>
                )}
            </Panel>
        </>
    );
}
