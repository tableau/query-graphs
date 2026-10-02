import {useEffect, useMemo, useState} from "react";
import type {TreeNode} from "../tree-description";
import type {CategoricalInsightDefinition} from "../insights/categorical";
import {computeCategoricalInsight} from "../insights/categorical";
import {CollapsiblePanel} from "./CollapsiblePanel";
import {useGraphRenderingStore} from "./store";
import "./PlanInsights.css";

interface PlanInsightsProps {
    root: TreeNode;
    definitions: readonly CategoricalInsightDefinition[];
}

function CategoryRow({
    value,
    nodeIds,
    active,
    owner,
}: {
    value: string;
    nodeIds: ReadonlySet<string>;
    active: boolean;
    owner: string;
}) {
    const setTransientHighlightedNodeIds = useGraphRenderingStore((state) => state.setTransientHighlightedNodeIds);
    const pointerOwner = `${owner}:pointer`;
    const focusOwner = `${owner}:focus`;
    useEffect(
        () => () => {
            setTransientHighlightedNodeIds(pointerOwner);
            setTransientHighlightedNodeIds(focusOwner);
        },
        [focusOwner, pointerOwner, setTransientHighlightedNodeIds],
    );

    return (
        <li
            className={`qg-insight-category${active ? " qg-insight-category-active" : ""}`}
            tabIndex={0}
            aria-label={`${value}: ${nodeIds.size}`}
            onMouseEnter={() => setTransientHighlightedNodeIds(pointerOwner, nodeIds)}
            onMouseLeave={() => setTransientHighlightedNodeIds(pointerOwner)}
            onFocus={() => setTransientHighlightedNodeIds(focusOwner, nodeIds)}
            onBlur={() => setTransientHighlightedNodeIds(focusOwner)}
        >
            <span className="qg-insight-category-label">{value}</span>
            <span className="qg-insight-category-count">{nodeIds.size}</span>
        </li>
    );
}

export function PlanInsights({root, definitions}: PlanInsightsProps) {
    const getNodeId = useGraphRenderingStore((state) => state.getNodeId);
    const highlightedNodeIds = useGraphRenderingStore((state) => state.highlightedNodeIds);
    const [open, setOpen] = useState(true);
    const histograms = useMemo(
        () =>
            definitions.map((definition) => ({
                definition,
                categories: computeCategoricalInsight(root, definition).map(({value, nodes}) => ({
                    value,
                    nodeIds: new Set(
                        nodes.flatMap((node) => {
                            const id = getNodeId(node);
                            return id === undefined ? [] : [id];
                        }),
                    ),
                })),
            })),
        [definitions, getNodeId, root],
    ).filter(({categories}) => categories.length > 0);
    if (histograms.length === 0) return null;

    const active = histograms.some(({categories}) =>
        categories.some(({nodeIds}) => [...nodeIds].some((id) => highlightedNodeIds.has(id))),
    );
    return (
        <CollapsiblePanel
            title={
                <>
                    Plan insights
                    {active ? (
                        <span className="qg-insights-active-indicator" role="img" aria-label="Contains highlighted nodes" />
                    ) : null}
                </>
            }
            className="qg-insights-panel"
            open={open}
            onOpenChange={setOpen}
        >
            {histograms.map(({definition, categories}) => (
                <section key={definition.id} className="qg-insight-histogram" aria-label={definition.title}>
                    <h3>{definition.title}</h3>
                    <ul>
                        {categories.map(({value, nodeIds}) => (
                            <CategoryRow
                                key={value}
                                value={value}
                                nodeIds={nodeIds}
                                active={[...nodeIds].some((id) => highlightedNodeIds.has(id))}
                                owner={`insight:${definition.id}:${value}`}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </CollapsiblePanel>
    );
}
