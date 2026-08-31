import {useMemo, useState, useCallback, useRef, useEffect} from "react";
import {Panel, useReactFlow, Node} from "reactflow";
import {TreeDescription, TreeNode, allChildren, visitTreeNodes} from "../tree-description";
import {formatMetric} from "../loader-utils";
import {useGraphRenderingStore} from "./store";
import {HIGHLIGHT_RULES, isCostlyScan} from "../highlight-rules";
import "./PlanInsights.css";

// The highlight categories, in the same precedence order used by the loaders, with the
// human-readable labels shown in the legend and summary.
const CATEGORIES = [
    {key: "costly-scan", label: "Costly scan"},
    {key: "index-rec", label: "Index recommendation"},
    {key: "index-used", label: "Index used"},
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

// How many scans to show in the "top offenders" list.
const TOP_OFFENDERS_LIMIT = 5;

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

// A vector / hybrid search node (e.g. Data Cloud `hybrid_search`), called out so the user can spot
// and jump to it. `label` is the index searched (falling back to the function name).
interface SearchNode {
    id: string;
    label: string;
    detail: string;
    hybrid: boolean;
}

interface PlanInsightsProps {
    treeDescription: TreeDescription;
    // Maps each tree node to the id react-flow assigns it, so we can pan to it.
    nodeIdMapping: Map<TreeNode, string>;
}

// An overlay panel providing at-a-glance plan insights: a color legend, a one-line summary of
// the issues found, a "jump to next issue" navigator, and a focus toggle that dims all
// non-flagged nodes so the interesting ones stand out on large plans.
export function PlanInsights({treeDescription, nodeIdMapping}: PlanInsightsProps) {
    const reactFlow = useReactFlow<TreeNode>();

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

    // Walk the tree once, grouping node ids by category and totaling the scan volume. A node can
    // belong to several categories at once — a costly scan may also carry an index recommendation
    // and use an index — so membership is read from the per-category flags rather than the single
    // `highlightNode` display color (which can only reflect one category by precedence). This keeps
    // the legend counts honest: an index-rec on a costly scan still counts under "index-rec".
    const {byCategory, totalProcessed, offenders, searchNodes, scanTypes} = useMemo(() => {
        const byCategory: Record<CategoryKey, string[]> = {"costly-scan": [], "index-rec": [], "index-used": []};
        let totalProcessed = 0;
        const scans: Offender[] = [];
        const searchNodes: SearchNode[] = [];
        // Group scan-node ids by their source type (`data-lake-object`, `tablescan`, …) for the
        // "Scan types" breakdown; the count is the list length and the ids drive click-to-drill.
        const scanTypeIds = new Map<string, string[]>();
        visitTreeNodes(
            treeDescription.root,
            (n) => {
                if (typeof n.scanProcessedRows === "number") {
                    totalProcessed += n.scanProcessedRows;
                }
                const id = nodeIdMapping.get(n);
                if (id === undefined) return;
                if (n.scanType) {
                    const ids = scanTypeIds.get(n.scanType);
                    if (ids) ids.push(id);
                    else scanTypeIds.set(n.scanType, [id]);
                }
                const costly = costlyOf(n);
                if (costly) byCategory["costly-scan"].push(id);
                if (n.hasIndexRec) byCategory["index-rec"].push(id);
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
        // Rank worst-first by raw processed volume — the rows Hyper actually had to read.
        scans.sort((a, b) => b.processed - a.processed);
        const offenders = scans.slice(0, TOP_OFFENDERS_LIMIT);
        // Most-frequent type first; ties broken alphabetically for a stable order.
        const scanTypes = [...scanTypeIds.entries()]
            .map(([type, ids]) => ({type, ids}))
            .sort((a, b) => b.ids.length - a.ids.length || a.type.localeCompare(b.type));
        return {byCategory, totalProcessed, offenders, searchNodes, scanTypes};
    }, [treeDescription, nodeIdMapping, costlyOf]);

    const counts: Record<CategoryKey, number> = {
        "costly-scan": byCategory["costly-scan"].length,
        "index-rec": byCategory["index-rec"].length,
        "index-used": byCategory["index-used"].length,
    };

    // Center a node in the viewport by react-flow id.
    const centerOnNode = useCallback(
        (id: string) => {
            const target = reactFlow.getNode(id) as Node<TreeNode> | undefined;
            if (target) {
                const x = target.position.x;
                const y = target.position.y + (target.height ?? 0) / 2;
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

    // "Jump to next issue" cycles through the actual issues (costly scans and index
    // recommendations), centering each in the viewport. A used index is good, not a problem, so it
    // is not part of the navigation even though it is counted in the legend. A node can be both a
    // costly scan and an index-rec, so the union is deduplicated to avoid visiting it twice.
    const issues = useMemo(() => [...new Set([...byCategory["costly-scan"], ...byCategory["index-rec"]])], [byCategory]);
    const [cursor, setCursor] = useState(-1);
    // Reset every navigation cursor when a different plan is loaded, so drill-down and "next issue"
    // start fresh instead of resuming at a position that referred to the previous plan's node list.
    useEffect(() => {
        cursorsRef.current = {};
        setCursor(-1);
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

    const totalIssues = counts["costly-scan"] + counts["index-rec"];
    // Single header line: only actionable findings (costly scans, index recommendations) plus the
    // total scan volume. "Index used" is informational, not actionable, so it stays in the legend
    // and node colors but is deliberately kept out of the header summary.
    const summaryParts: string[] = [];
    if (counts["costly-scan"]) summaryParts.push(`${counts["costly-scan"]} costly scan${counts["costly-scan"] > 1 ? "s" : ""}`);
    if (counts["index-rec"]) summaryParts.push(`${counts["index-rec"]} index recommendation${counts["index-rec"] > 1 ? "s" : ""}`);
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
    const summary = summaryParts.length ? summaryParts.join(", ") : "No scan issues detected";

    return (
        <>
            {/* Summary sits on the top row, centered (same line as the title box). */}
            <Panel position="top-center" className="qg-insights qg-insights-summary-panel">
                <span className={`qg-insights-summary ${totalIssues ? "qg-insights-verdict-warn" : "qg-insights-verdict-ok"}`}>
                    {summary}
                </span>
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
                        <div className="qg-insights-legend">
                            {CATEGORIES.map((c) => {
                                const count = counts[c.key];
                                const empty = count === 0;
                                return (
                                    <button
                                        key={c.key}
                                        type="button"
                                        className={`qg-insights-legend-item${empty ? " qg-insights-legend-empty" : ""}`}
                                        onClick={() => drillInto(byCategory[c.key], c.key)}
                                        title={
                                            empty
                                                ? `No ${c.label.toLowerCase()} nodes in this plan`
                                                : `Click to drill into ${c.label.toLowerCase()} nodes`
                                        }
                                    >
                                        <span className={`qg-insights-swatch qg-swatch-${c.key}`} />
                                        {c.label}
                                        <span className="qg-insights-count">({count})</span>
                                    </button>
                                );
                            })}
                        </div>
                        {offenders.length > 0 ? (
                            <div className="qg-insights-offenders">
                                <div className="qg-insights-offenders-title">Top scans by rows processed</div>
                                {offenders.map((o, i) => (
                                    <button
                                        key={o.id}
                                        type="button"
                                        className={`qg-insights-offender${o.costlyScan ? " qg-insights-offender-costly-scan" : ""}`}
                                        onClick={() => centerOnNode(o.id)}
                                        title={
                                            `Scan of ${o.label}: processed ${formatMetric(o.processed)} rows` +
                                            (typeof o.matching === "number"
                                                ? `, ${formatMetric(o.matching)} matched restrictions`
                                                : "") +
                                            ". Click to jump."
                                        }
                                    >
                                        <span className="qg-insights-offender-rank">{i + 1}.</span>
                                        <span className="qg-insights-offender-label">{trimLabel(o.label)}</span>
                                        <span className="qg-insights-offender-metric">{formatMetric(o.processed)}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        {scanTypes.length > 0 ? (
                            <div className="qg-insights-scantypes">
                                <div className="qg-insights-scantypes-title">Scan types</div>
                                {scanTypes.map((s) => (
                                    <button
                                        key={s.type}
                                        type="button"
                                        className="qg-insights-scantype"
                                        onClick={() => drillInto(s.ids, `scantype:${s.type}`)}
                                        title={`${s.ids.length} ${s.type} scan${s.ids.length > 1 ? "s" : ""}. Click to jump${s.ids.length > 1 ? " (cycles through them)" : ""}.`}
                                    >
                                        <span className="qg-insights-scantype-label">{s.type}</span>
                                        <span className="qg-insights-scantype-count">{s.ids.length}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        {searchNodes.length > 0 ? (
                            <div className="qg-insights-search">
                                <div className="qg-insights-search-title">
                                    {searchNodes.some((s) => s.hybrid) ? "Hybrid / vector search" : "Vector search"}
                                </div>
                                {searchNodes.map((s) => (
                                    <button
                                        key={s.id}
                                        type="button"
                                        className="qg-insights-search-item"
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
