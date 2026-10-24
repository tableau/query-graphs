import type {TreeNode} from "../tree-description";
import type {CategoricalInsightDefinition} from "../insights/categorical";
import {CategoricalInsightPanel} from "./CategoryTree";

interface PlanInsightsProps {
    root: TreeNode;
    definitions: readonly CategoricalInsightDefinition[];
}

export function PlanInsights({root, definitions}: PlanInsightsProps) {
    return <CategoricalInsightPanel root={root} definitions={definitions} title="Plan Insights" />;
}
