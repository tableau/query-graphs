import type {ReactElement, MouseEvent, RefObject, CSSProperties} from "react";
import {memo, useCallback, useRef, useState, useEffect} from "react";
import type {Node, NodeProps} from "@xyflow/react";
import {Handle, Position} from "@xyflow/react";
import cc from "classcat";
import type {TreeNode} from "../tree-description";
import {NodeIcon} from "./NodeIcon";
import "./QueryNode.css";
import {useGraphRenderingStore} from "./store";
import {assert} from "../assert";

type NodeData = TreeNode & {resizeObserver: ResizeObserver};

export type QueryGraphNode = Node<NodeData, "querynode">;

// How many more columns each click of the `...` marker reveals. Matches the loader's initial preview
// count (COLUMN_PREVIEW_COUNT in hyper.ts) so the first render lines up with the static fallback string.
const COLUMN_PREVIEW_STEP = 2;

// A column-list property (`columns`, `outputs`) whose full list was truncated by the loader. Shows the
// first `COLUMN_PREVIEW_STEP` names, then a clickable `... [remaining]` marker that reveals that many
// more per click and updates the remaining count, until every column is shown. The click is stopped
// from bubbling so revealing columns never toggles the node's expand/collapse.
function ColumnPreview({names}: {names: string[]}): ReactElement {
    const [shown, setShown] = useState(COLUMN_PREVIEW_STEP);
    const onMore = useCallback((e: MouseEvent) => {
        e.stopPropagation();
        setShown((n) => n + COLUMN_PREVIEW_STEP);
    }, []);
    const remaining = names.length - shown;
    return (
        <span className="qg-prop-value">
            {names.slice(0, shown).join(", ")}
            {remaining > 0 && (
                <>
                    {" "}
                    <button type="button" className="qg-prop-more" onClick={onMore}>
                        ... [{remaining}]
                    </button>
                </>
            )}
        </span>
    );
}

// A long property value (e.g. a rendered `CASE … END` expression or a big predicate) is collapsed to
// its first `VALUE_PREVIEW_CHARS` characters with a trailing clickable `more` marker; clicking toggles
// between the truncated and full text. Short values render verbatim with no marker. The click is
// stopped from bubbling so expanding a value never toggles the node's expand/collapse.
const VALUE_PREVIEW_CHARS = 60;
function ValuePreview({text}: {text: string}): ReactElement {
    const [expanded, setExpanded] = useState(false);
    const onToggle = useCallback((e: MouseEvent) => {
        e.stopPropagation();
        setExpanded((v) => !v);
    }, []);
    if (text.length <= VALUE_PREVIEW_CHARS) {
        return <span className="qg-prop-value">{text}</span>;
    }
    return (
        <span className={cc(["qg-prop-value", {"qg-prop-value-expanded": expanded}])}>
            {expanded ? text : text.slice(0, VALUE_PREVIEW_CHARS).trimEnd() + "…"}{" "}
            <button type="button" className="qg-prop-more" onClick={onToggle}>
                {expanded ? "less" : "more"}
            </button>
        </span>
    );
}

function useResizeObservedRef<T extends Element>(resizeObserver: ResizeObserver): RefObject<T | null> {
    const ref = useRef<T>(null);
    useEffect(() => {
        assert(ref.current !== null);
        const currNode = ref.current;
        resizeObserver.observe(currNode);
        return () => resizeObserver.unobserve(currNode);
    }, [resizeObserver]);
    return ref;
}

function QueryNode({data, id}: NodeProps<QueryGraphNode>) {
    const bodyRef = useResizeObservedRef<HTMLDivElement>(data.resizeObserver);
    const headRef = useResizeObservedRef<HTMLDivElement>(data.resizeObserver);

    const expanded = useGraphRenderingStore((s) => s.expandedNodes[id]);
    const toggleNode = useGraphRenderingStore((s) => s.toggleExpandedNode);
    const subtreeExpanded = useGraphRenderingStore((s) => s.expandedSubtrees[id]);
    const toggleSubtree = useGraphRenderingStore((s) => s.toggleExpandedSubtree);

    const hasProperties = data.properties?.size;
    const hasSubtree = data.collapsedChildren && data.collapsedChildren.length > 0;

    const onClick = useCallback(
        (e: MouseEvent) => {
            if (e.shiftKey) {
                if (hasSubtree) toggleSubtree(id);
            } else {
                if (hasProperties) toggleNode(id);
            }
            e.stopPropagation();
        },
        [toggleNode, toggleSubtree, hasProperties, hasSubtree, id],
    );
    const onSubtreeHandleClick = useCallback(
        (e: MouseEvent) => {
            if (hasSubtree) toggleSubtree(id);
            e.stopPropagation();
        },
        [toggleSubtree, hasSubtree, id],
    );

    const children = [] as ReactElement[];
    for (const [key, value] of (data.properties ?? new Map<string, string>()).entries()) {
        // `table-metadata` is a grouped property: a header row (`table-metadata:`) followed by one
        // indented bullet row per sub-item (`identifier`, `partitioned-by`, `sort-order`). The loader
        // packs the sub-items as newline-separated `label: value` lines; render them as a nested list.
        if (key === "table-metadata") {
            children.push(
                <div key={key} className="qg-prop qg-prop-group-header">
                    <span className="qg-prop-name">{key}:</span>
                </div>,
            );
            value.split("\n").forEach((line, i) => {
                const sep = line.indexOf(": ");
                const subKey = sep >= 0 ? line.slice(0, sep) : line;
                const subVal = sep >= 0 ? line.slice(sep + 2) : "";
                children.push(
                    <div key={`${key}-${i}`} className="qg-prop qg-prop-subitem">
                        <span className="qg-prop-name">- {subKey}:</span> <span className="qg-prop-value">{subVal}</span>
                    </div>,
                );
            });
            continue;
        }
        // A truncated column list (`columns`, `outputs`, or `duplicate-columns`): render an interactive
        // preview whose `... [n]` marker reveals more columns on click, instead of the static fallback
        // string in `value`. The `duplicate-columns` list carries the node's rose warning tint; the
        // plain column lists are untinted.
        const columnList = data.columnLists?.get(key);
        if (columnList) {
            children.push(
                <div key={key} className={cc(["qg-prop", {"qg-prop-duplicate-columns": key === "duplicate-columns"}])}>
                    <span className="qg-prop-name">{key}:</span> <ColumnPreview names={columnList} />
                </div>,
            );
            continue;
        }
        // A few properties are called out among the other scan metrics with a highlight:
        // `index-rec` gets an amber highlight; `index-used` is highlighted informational blue, but
        // only when an index was actually used (value != "no").
        const emphasized = key === "index-rec";
        const indexUsed = key === "index-used" && value !== "no";
        // On a costly scan, the processed-rows / rows-matching rows are flagged in light red.
        const costlyScan = data.costlyScan && (key === "processed-rows" || key === "rows-matching");
        // On a high-volume scan (that isn't also costly, which already tints it red), the processed-rows
        // row is tinted indigo to match the node highlight.
        const highVolumeScan = data.highVolumeScan && !data.costlyScan && key === "processed-rows";
        // On a hybrid / vector search node, the `function` (e.g. `hybrid_search`) row is tinted teal to
        // match the plan-insights legend accent, so the "this is a hybrid search" signal reads at a
        // glance.
        const vectorSearch = !!data.vectorSearch && key === "function";
        // The `duplicate-columns` row (the loader-added list of repeated output names) is tinted to
        // match the node's rose warning border.
        const duplicateColumns = key === "duplicate-columns";
        const rowClassName = cc([
            "qg-prop",
            {
                "qg-prop-emphasized": emphasized,
                "qg-prop-index-used": indexUsed,
                "qg-prop-costly-scan": costlyScan,
                "qg-prop-high-volume-scan": highVolumeScan,
                "qg-prop-vector-search": vectorSearch,
                "qg-prop-duplicate-columns": duplicateColumns,
            },
        ]);
        // Tint the cpu-cycles row with the same runtime-heatmap color used on the node label, so an
        // expensive node reads the same whether it is collapsed (label only) or expanded. Likewise,
        // tint a costly scan's processed-rows / rows-matching rows with the same proportional red as
        // the node box, so the opened node matches its collapsed shade.
        let rowStyle: CSSProperties | undefined;
        if (key === "cpu-cycles" && data.nodeColor) {
            rowStyle = {background: data.nodeColor};
        } else if (key === "memory-bytes" && data.memoryColor) {
            // Tint the memory-bytes row with the memory-hotspot orange, mirroring how cpu-cycles is
            // tinted with the runtime-heatmap violet.
            rowStyle = {background: data.memoryColor};
        } else if (costlyScan && data.costlyScanColor) {
            rowStyle = {background: data.costlyScanColor};
        }
        // The "(likely early probe)" annotation the loader appends to a 0-row processed-rows value is
        // highlighted green (benign — the scan was pruned, saving work). Split it out so only the
        // annotation is tinted, not the "0" itself.
        const earlyProbeIdx = key === "processed-rows" ? value.indexOf("(likely early probe)") : -1;
        // The early-probe annotation needs its own tinted span, so it keeps the plain value markup. Any
        // other value goes through `ValuePreview`, which truncates + adds a `more`/`less` toggle when the
        // text is long (and renders verbatim otherwise).
        const valueEl =
            earlyProbeIdx >= 0 ? (
                <span className="qg-prop-value">
                    {value.slice(0, earlyProbeIdx)}
                    <span className="qg-prop-early-probe">{value.slice(earlyProbeIdx)}</span>
                </span>
            ) : (
                <ValuePreview text={value} />
            );
        children.push(
            <div key={key} className={rowClassName} style={rowStyle}>
                <span className="qg-prop-name">{key}:</span> {valueEl}
            </div>,
        );
    }

    const nodeClassName = cc([
        "qg-graph-node",
        {
            "qg-expanded": expanded,
            "qg-collapsed": hasProperties && !expanded,
            "qg-no-props": !hasProperties,
            // Node color reflects the node's content (precedence set in the loader):
            // costly scan (red) > high-volume scan (indigo) > index recommendation (amber) > index used (blue).
            "qg-node-costly-scan": data.highlightNode === "costly-scan",
            "qg-node-high-volume-scan": data.highlightNode === "high-volume-scan",
            "qg-node-index-rec": data.highlightNode === "index-rec",
            "qg-node-index-used": data.highlightNode === "index-used",
            // A node can be a costly scan (red fill) AND carry an index recommendation. The fill can
            // only show one category, so surface the index-rec signal on the border in its amber hue
            // when another category won the fill — otherwise the recommendation would be invisible.
            "qg-node-index-rec-border": data.hasIndexRec && data.highlightNode !== "index-rec",
            // A hybrid / vector search node gets a teal border matching the plan-insights legend, so it
            // is identifiable in the graph. It's a characteristic, not an issue, so it only borders the
            // node (no fill) and never competes with the red/amber/blue category fills above.
            "qg-node-vector-search": !!data.vectorSearch,
            // A node whose output projects a duplicate column name: rose warning border (no fill, so it
            // never competes with the category fills), matching the plan-insights legend accent.
            "qg-node-duplicate-columns": !!data.duplicateColumns?.length,
            // A node that raised a runtime error (typically the execution-target root of a failed plan):
            // bold red border. The most severe state, so it outranks every category above (see the CSS,
            // where it is ordered to win the border and persist through hover/expand).
            "qg-node-error": !!data.errorMessage,
        },
    ]);

    // A (possibly multi-color) bar drawn above and below the node.
    const colorBar = (colors: string[] | undefined, position: "above" | "below") =>
        colors?.length ? (
            <div className={cc(["qg-color-bar", `qg-color-bar-${position}`])}>
                {colors.map((c, i) => (
                    <span key={i} className="qg-color-bar-seg" style={{backgroundColor: c}} />
                ))}
            </div>
        ) : null;

    const handleClassName = cc({
        "qg-subtree-handle": hasSubtree,
        "qg-expanded": hasSubtree && subtreeExpanded,
        "qg-collapsed": hasSubtree && !subtreeExpanded,
    });

    // A costly scan's node box is tinted proportionally to how many rows it read (heavier scans read
    // as a deeper red), via a CSS custom property the `.qg-node-costly-scan` rule consumes. Left unset
    // for other nodes, so the hover/expanded "white" state can still take over.
    const nodeStyle =
        data.highlightNode === "costly-scan" && data.costlyScanColor
            ? ({"--qg-costly-scan-color": data.costlyScanColor} as CSSProperties)
            : undefined;

    // A runtime error is the most severe thing a node can carry, so lead the hover tooltip with it
    // (⚠-prefixed), then append any other highlight reason below.
    const title = data.errorMessage
        ? data.highlightReason
            ? `⚠ ${data.errorMessage}\n${data.highlightReason}`
            : `⚠ ${data.errorMessage}`
        : data.highlightReason;

    return (
        <>
            <Handle type="target" position={Position.Top} />
            <div className={nodeClassName} style={nodeStyle} onClick={onClick} title={title}>
                <div className="qg-graph-node-head" ref={headRef}>
                    {colorBar(data.barsAbove, "above")}
                    <NodeIcon icon={data.icon} iconColor={data.iconColor} />
                    {/* The label carries the runtime-hotspot violet (nodeColor); if the node is a memory
                        hotspot but not a CPU one, it shows the memory-hotspot orange instead. When it is
                        both, CPU wins the label and the memory signal still shows on the memory-bytes row. */}
                    <div className="qg-graph-node-label" style={{background: data.nodeColor ?? data.memoryColor}}>
                        {data.name}
                    </div>
                </div>
                <div className="qg-graph-node-body-wrapper nowheel">
                    <div ref={bodyRef} className="qg-graph-node-body">
                        {children}
                    </div>
                </div>
                {colorBar(data.barsBelow, "below")}
            </div>
            <Handle type="source" position={Position.Bottom} className={handleClassName} onClick={onSubtreeHandleClick}>
                {hasSubtree ? (subtreeExpanded ? "-" : "+") : ""}
            </Handle>
        </>
    );
}

const memoizedQueryNode = memo(QueryNode);
export {memoizedQueryNode as QueryNode};
