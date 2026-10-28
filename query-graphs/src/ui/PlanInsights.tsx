import {useId, useMemo, useState, type ReactNode} from "react";
import type {TreeNode} from "../tree-description";
import type {CategoricalInsightDefinition} from "../insights/categorical";
import {computeCategoricalInsight} from "../insights/categorical";
import {CategoryTree} from "./CategoryTree";
import {CollapsiblePanel} from "./CollapsiblePanel";
import {ScrollableArea} from "./ScrollableArea";
import {useGraphRenderingStore} from "./store";
import "./PlanInsights.css";

interface PlanInsightsProps {
    root: TreeNode;
    definitions: readonly CategoricalInsightDefinition[];
}

export function PlanInsights({root, definitions}: PlanInsightsProps) {
    const getNodeId = useGraphRenderingStore((state) => state.getNodeId);
    const highlightedNodeIds = useGraphRenderingStore((state) => state.highlightedNodeIds);
    const [open, setOpen] = useState(false);
    const sections = useMemo(
        () =>
            definitions.flatMap((definition) => {
                const categories = computeCategoricalInsight(root, definition);
                const nodeIds = new Set(
                    categories.flatMap(({nodes}) =>
                        nodes.flatMap((node) => {
                            const id = getNodeId(node);
                            return id === undefined ? [] : [id];
                        }),
                    ),
                );
                return categories.length ? [{definition, categories, nodeIds}] : [];
            }),
        [definitions, getNodeId, root],
    );
    if (sections.length === 0) return null;

    const isHighlighted = (nodeIds: ReadonlySet<string>) => [...nodeIds].some((id) => highlightedNodeIds.has(id));
    const active = sections.some(({nodeIds}) => isHighlighted(nodeIds));
    return (
        <CollapsiblePanel
            title="Plan Insights"
            className="qg-insights-panel"
            containsHighlightedContent={active}
            open={open}
            onOpenChange={setOpen}
        >
            <ScrollableArea>
                {sections.map(({definition, categories, nodeIds}) => (
                    <InsightSection
                        key={definition.id}
                        title={definition.title}
                        count={categories.reduce((sum, category) => sum + category.nodes.length, 0)}
                        highlighted={isHighlighted(nodeIds)}
                    >
                        <CategoryTree categories={categories} title={definition.title} />
                    </InsightSection>
                ))}
            </ScrollableArea>
        </CollapsiblePanel>
    );
}

function InsightSection({
    title,
    count,
    highlighted,
    children,
}: {
    title: string;
    count: number;
    highlighted: boolean;
    children: ReactNode;
}) {
    // Section headers are outside the insight content, so each renderer owns its own navigation.
    // Sections start open and collapse independently without unmounting their content.
    const [open, setOpen] = useState(true);
    const contentId = useId();
    return (
        <section className="qg-plan-insight" aria-label={title}>
            <h3>
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={contentId}
                    className={!open && highlighted ? "qg-plan-insight-highlighted" : undefined}
                    onClick={() => setOpen(!open)}
                >
                    <svg viewBox="0 0 16 16" aria-hidden="true" className={open ? "qg-plan-insight-open" : ""}>
                        <path d="M5.5 3.5 10.5 8l-5 4.5" />
                    </svg>
                    <span>{title}</span>
                    <span className="qg-plan-insight-count">{count}</span>
                </button>
            </h3>
            <div id={contentId} hidden={!open} className="qg-plan-insight-content">
                {children}
            </div>
        </section>
    );
}
