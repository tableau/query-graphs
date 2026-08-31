import {memo, ReactElement, MouseEvent, useCallback, useRef, useState, useEffect, RefObject, CSSProperties} from "react";
import {Handle, NodeProps, Position} from "reactflow";
import cc from "classcat";
import {TreeNode} from "../tree-description";
import {NodeIcon} from "./NodeIcon";
import "./QueryNode.css";
import {useGraphRenderingStore} from "./store";
import {assert} from "../loader-utils";

type NodeData = TreeNode & {resizeObserver: ResizeObserver};

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

function useResizeObservedRef<T extends Element>(resizeObserver: ResizeObserver): RefObject<T> {
    const ref = useRef<T>(null);
    useEffect(() => {
        assert(ref.current !== null);
        const currNode = ref.current;
        resizeObserver.observe(currNode);
        return () => resizeObserver.unobserve(currNode);
    }, [resizeObserver]);
    return ref;
}

function QueryNode({data, id}: NodeProps<NodeData>) {
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
        // A truncated column list (`columns`, `outputs`): render an interactive preview whose `... [n]`
        // marker reveals more columns on click, instead of the static fallback string in `value`.
        const columnList = data.columnLists?.get(key);
        if (columnList) {
            children.push(
                <div key={key} className="qg-prop">
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
        // On a hybrid / vector search node, the `function` (e.g. `hybrid_search`) row is tinted teal to
        // match the plan-insights legend accent, so the "this is a hybrid search" signal reads at a
        // glance.
        const vectorSearch = !!data.vectorSearch && key === "function";
        const rowClassName = cc([
            "qg-prop",
            {
                "qg-prop-emphasized": emphasized,
                "qg-prop-index-used": indexUsed,
                "qg-prop-costly-scan": costlyScan,
                "qg-prop-vector-search": vectorSearch,
            },
        ]);
        // Tint the cpu-cycles row with the same runtime-heatmap color used on the node label, so an
        // expensive node reads the same whether it is collapsed (label only) or expanded. Likewise,
        // tint a costly scan's processed-rows / rows-matching rows with the same proportional red as
        // the node box, so the opened node matches its collapsed shade.
        let rowStyle: CSSProperties | undefined;
        if (key === "cpu-cycles" && data.nodeColor) {
            rowStyle = {background: data.nodeColor};
        } else if (costlyScan && data.costlyScanColor) {
            rowStyle = {background: data.costlyScanColor};
        }
        // The "(likely early probe)" annotation the loader appends to a 0-row processed-rows value is
        // highlighted green (benign — the scan was pruned, saving work). Split it out so only the
        // annotation is tinted, not the "0" itself.
        const earlyProbeIdx = key === "processed-rows" ? value.indexOf("(likely early probe)") : -1;
        const valueContent =
            earlyProbeIdx >= 0 ? (
                <>
                    {value.slice(0, earlyProbeIdx)}
                    <span className="qg-prop-early-probe">{value.slice(earlyProbeIdx)}</span>
                </>
            ) : (
                value
            );
        children.push(
            <div key={key} className={rowClassName} style={rowStyle}>
                <span className="qg-prop-name">{key}:</span> <span className="qg-prop-value">{valueContent}</span>
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
            // costly scan (red) > index recommendation (amber) > index used (blue).
            "qg-node-costly-scan": data.highlightNode === "costly-scan",
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
        },
    ]);

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

    return (
        <>
            <Handle type="target" position={Position.Top} />
            <div className={nodeClassName} style={nodeStyle} onClick={onClick} title={data.highlightReason}>
                <div className="qg-graph-node-head" ref={headRef}>
                    <NodeIcon icon={data.icon} iconColor={data.iconColor} />
                    <div className="qg-graph-node-label" style={{background: data.nodeColor}}>
                        {data.name}
                    </div>
                </div>
                <div className="qg-graph-node-body-wrapper nowheel">
                    <div ref={bodyRef} className="qg-graph-node-body">
                        {children}
                    </div>
                </div>
            </div>
            <Handle type="source" position={Position.Bottom} className={handleClassName} onClick={onSubtreeHandleClick}>
                {hasSubtree ? (subtreeExpanded ? "-" : "+") : ""}
            </Handle>
        </>
    );
}

const memoizedQueryNode = memo(QueryNode);
export {memoizedQueryNode as QueryNode};
