import type {MouseEvent} from "react";
import {createContext, memo, useCallback, useContext, useState} from "react";
import type {Node, NodeProps} from "@xyflow/react";
import {Handle, Position} from "@xyflow/react";
import cc from "classcat";
import {formatPropertyValue} from "../loaders/loader-utils";
import type {PropertyEntry, TreeNode} from "../tree-description";
import {NodeIcon} from "./NodeIcon";
import "./PanelSurface.css";
import "./QueryNode.css";
import {ScrollableArea} from "./ScrollableArea";
import {useGraphRenderingStore} from "./store";
import {AnimateGraphChangeContext, subtreeHandleId, useAnimateGraphChange} from "./useAnimatedGraphLayout";

export type QueryGraphNode = Node<TreeNode, "querynode">;

// Render a scalar property as `name: value`, colored by its emphasis.
function ScalarRow({name, entry}: {name: string; entry: PropertyEntry}) {
    return (
        <div
            className={cc([
                "qg-prop-row",
                {
                    "qg-prop-highlighted": entry.highlighted,
                    "qg-prop-recommended": entry.recommended,
                    "qg-prop-informational": entry.informational,
                },
            ])}
        >
            <span className="qg-prop-name">{name}:</span> <span className="qg-prop-value">{formatPropertyValue(entry)}</span>
        </div>
    );
}

// Whether the user expanded or collapsed a group, kept across unmounts (a
// closed parent group, a collapsed subtree) so reopening restores it.
const groupExpanded = new WeakMap<PropertyEntry, boolean>();

// The id of the graph node whose properties are rendered; unset for the plan metadata.
const NodeIdContext = createContext<string | undefined>(undefined);

// Render a property group as a header that expands and collapses its rows.
// Groups start collapsed, except recommended ones. Expanding a group also
// expands every group nested in it (`expandGroups`); each can then be
// collapsed on its own.
function GroupRow({
    name,
    entry,
    rows,
    expandGroups,
}: {
    name: string;
    entry: PropertyEntry;
    rows: Map<string, PropertyEntry>;
    expandGroups?: boolean;
}) {
    const [expanded, setExpanded] = useState(() => groupExpanded.get(entry) ?? expandGroups ?? entry.recommended === true);
    const nodeId = useContext(NodeIdContext);
    const animateGraphChange = useContext(AnimateGraphChangeContext);
    const onClick = useCallback(
        (e: MouseEvent<HTMLElement>) => {
            const toggle = () => {
                groupExpanded.set(entry, !expanded);
                setExpanded(!expanded);
            };
            // Inside a graph node, resize the node smoothly and keep it in place.
            const nodeElement = e.currentTarget.closest<HTMLElement>(".qg-graph-node");
            if (nodeId !== undefined && animateGraphChange !== null && nodeElement !== null) {
                animateGraphChange(toggle, {resizingNodes: [{nodeId, nodeElement}]});
            } else {
                toggle();
            }
            e.stopPropagation();
        },
        [entry, expanded, nodeId, animateGraphChange],
    );
    return (
        <div className={cc(["qg-prop-group", {"qg-prop-recommended": entry.recommended}])}>
            <button
                type="button"
                className={cc(["qg-prop-group-header", {"qg-prop-highlighted": entry.highlighted, "qg-expanded": expanded}])}
                aria-expanded={expanded}
                onClick={onClick}
            >
                <span className="qg-prop-group-toggle" aria-hidden="true" />
                <span className="qg-prop-name">{name}</span>
            </button>
            {expanded ? (
                <div className="qg-prop-group-body">
                    <PropertyList properties={rows} expandGroups />
                </div>
            ) : null}
        </div>
    );
}

// Render a map of properties, one row each: scalars as `ScalarRow`, nested
// groups as the expandable `GroupRow`. Used by node bodies and the plan metadata.
export function PropertyList({properties, expandGroups}: {properties: Map<string, PropertyEntry>; expandGroups?: boolean}) {
    return (
        <>
            {Array.from(properties.entries()).map(([key, entry]) =>
                entry.value instanceof Map ? (
                    <GroupRow key={key} name={key} entry={entry} rows={entry.value} expandGroups={expandGroups} />
                ) : (
                    <ScalarRow key={key} name={key} entry={entry} />
                ),
            )}
        </>
    );
}

function QueryNode({data, id}: NodeProps<QueryGraphNode>) {
    const expanded = useGraphRenderingStore((s) => s.expandedNodes[id]);
    const toggleNode = useGraphRenderingStore((s) => s.toggleExpandedNode);
    const subtreeExpanded = useGraphRenderingStore((s) => s.expandedSubtrees[id]);
    const toggleSubtree = useGraphRenderingStore((s) => s.toggleExpandedSubtree);
    const highlighted = useGraphRenderingStore((s) => s.visibleHighlightedNodeIds.has(id));
    const descendantHighlighted = useGraphRenderingStore((s) => s.highlightedCollapsedAncestorIds.has(id));
    const setHoveredNodeIds = useGraphRenderingStore((s) => s.setHoveredNodeIds);
    const animateGraphChange = useAnimateGraphChange();

    const hasProperties = data.properties?.size;
    const hasSubtree = data.collapsedChildren && data.collapsedChildren.length > 0;

    const onClick = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (e.shiftKey) {
                if (hasSubtree) animateGraphChange(() => toggleSubtree(id));
            } else {
                if (hasProperties) {
                    animateGraphChange(() => toggleNode(id), {
                        resizingNodes: [{nodeId: id, nodeElement: e.currentTarget}],
                    });
                }
            }
            e.stopPropagation();
        },
        [animateGraphChange, toggleNode, toggleSubtree, hasProperties, hasSubtree, id],
    );
    const onSubtreeToggleClick = useCallback(
        (e: MouseEvent) => {
            if (hasSubtree) animateGraphChange(() => toggleSubtree(id));
            e.stopPropagation();
        },
        [animateGraphChange, toggleSubtree, hasSubtree, id],
    );

    const nodeClassName = cc([
        "qg-graph-node",
        {
            "qg-expanded": expanded,
            "qg-collapsed": hasProperties && !expanded,
            "qg-no-props": !hasProperties,
            "qg-highlighted": highlighted,
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

    const subtreeToggleClassName = cc([
        "qg-subtree-toggle",
        {
            "qg-expanded": subtreeExpanded,
            "qg-collapsed": !subtreeExpanded,
            "qg-descendant-highlighted": descendantHighlighted && !subtreeExpanded,
        },
    ]);
    const subtreeToggleLabel = `${subtreeExpanded ? "Collapse" : "Expand"} subtree${data.name ? ` for ${data.name}` : ""}`;

    return (
        <>
            <Handle type="target" position={Position.Top} />
            <div
                className={nodeClassName}
                onClick={onClick}
                onMouseEnter={() => setHoveredNodeIds(new Set([id]))}
                onMouseLeave={() => setHoveredNodeIds(undefined)}
            >
                {colorBar(data.barsAbove, "above")}
                <div className="qg-graph-node-head">
                    <NodeIcon icon={data.icon} iconColor={data.iconColor} />
                    <div className="qg-graph-node-label" style={{background: data.nodeColor}}>
                        {data.name}
                    </div>
                </div>
                {/* `inert` keeps the group buttons of a collapsed (clipped, not hidden) body out of the tab order. */}
                <div className="qg-graph-node-body-wrapper nowheel" inert={!expanded}>
                    <ScrollableArea className="qg-graph-node-body">
                        <NodeIdContext.Provider value={id}>
                            {data.properties ? <PropertyList properties={data.properties} /> : null}
                        </NodeIdContext.Provider>
                    </ScrollableArea>
                </div>
                {colorBar(data.barsBelow, "below")}
            </div>
            <Handle id={subtreeHandleId} type="source" position={Position.Bottom} />
            {hasSubtree ? (
                <button
                    type="button"
                    className={subtreeToggleClassName}
                    onClick={onSubtreeToggleClick}
                    aria-label={subtreeToggleLabel}
                    aria-expanded={!!subtreeExpanded}
                >
                    <svg className="qg-subtree-handle-icon" viewBox="0 0 16 16" aria-hidden="true">
                        <circle className="qg-subtree-handle-background" cx="8" cy="8" r="7.25" />
                        <path d="M4.5 8h7" />
                        <path className="qg-subtree-handle-vertical" d="M8 4.5v7" />
                    </svg>
                </button>
            ) : null}
        </>
    );
}

const memoizedQueryNode = memo(QueryNode);
export {memoizedQueryNode as QueryNode};
