import {useId, useMemo, useState, type ReactNode} from "react";
import type {TreeNode} from "../tree-description";
import type {CategoricalInsightDefinition} from "../insights/categorical";
import {computeCategoricalInsight} from "../insights/categorical";
import {CategoryTree} from "./CategoryTree";
import {CollapsiblePanel} from "./CollapsiblePanel";
import {ScrollableArea} from "./ScrollableArea";
import "./PlanInsights.css";

interface PlanInsightsProps {
    root: TreeNode;
    definitions: readonly CategoricalInsightDefinition[];
}

export function PlanInsights({root, definitions}: PlanInsightsProps) {
    const [open, setOpen] = useState(false);
    const sections = useMemo(
        () =>
            definitions.flatMap((definition) => {
                const categories = computeCategoricalInsight(root, definition);
                return categories.length ? [{definition, categories}] : [];
            }),
        [definitions, root],
    );
    if (sections.length === 0) return null;

    return (
        <CollapsiblePanel title="Plan Insights" className="qg-insights-panel" open={open} onOpenChange={setOpen}>
            <ScrollableArea>
                {sections.map(({definition, categories}) => (
                    <InsightSection
                        key={definition.id}
                        title={definition.title}
                        count={categories.reduce((sum, category) => sum + category.nodes.length, 0)}
                    >
                        <CategoryTree categories={categories} title={definition.title} />
                    </InsightSection>
                ))}
            </ScrollableArea>
        </CollapsiblePanel>
    );
}

function InsightSection({title, count, children}: {title: string; count: number; children: ReactNode}) {
    // Section headers are outside the insight content, so each renderer owns its own navigation.
    // Sections start open and collapse independently without unmounting their content.
    const [open, setOpen] = useState(true);
    const contentId = useId();
    return (
        <section className="qg-plan-insight" aria-label={title}>
            <h3>
                <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)}>
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
