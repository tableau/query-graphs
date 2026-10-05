import {useMemo, useState} from "react";
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

function CategoryRow({value, nodeIds, active}: {value: string; nodeIds: ReadonlySet<string>; active: boolean}) {
    const setHoveredNodeIds = useGraphRenderingStore((state) => state.setHoveredNodeIds);
    const setFocusedNodeIds = useGraphRenderingStore((state) => state.setFocusedNodeIds);

    return (
        <li
            className={`qg-insight-category${active ? " qg-insight-category-active" : ""}`}
            tabIndex={0}
            aria-label={`${value}: ${nodeIds.size}`}
            onMouseEnter={() => setHoveredNodeIds(nodeIds)}
            onMouseLeave={() => setHoveredNodeIds(undefined)}
            onFocus={() => setFocusedNodeIds(nodeIds)}
            onBlur={() => setFocusedNodeIds(undefined)}
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
    const categoryLists = useMemo(
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
    // If there are no insights, don't render this panel at all.
    if (categoryLists.length === 0) return null;

    const active = categoryLists.some(({categories}) =>
        categories.some(({nodeIds}) => [...nodeIds].some((id) => highlightedNodeIds.has(id))),
    );
    return (
        <CollapsiblePanel
            title="Plan insights"
            className="qg-insights-panel"
            containsHighlightedContent={active}
            open={open}
            onOpenChange={setOpen}
        >
            {categoryLists.map(({definition, categories}) => (
                <section key={definition.id} className="qg-insight-category-list" aria-label={definition.title}>
                    <h3>{definition.title}</h3>
                    <ul>
                        {categories.map(({value, nodeIds}) => (
                            <CategoryRow
                                key={value}
                                value={value}
                                nodeIds={nodeIds}
                                active={[...nodeIds].some((id) => highlightedNodeIds.has(id))}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </CollapsiblePanel>
    );
}
