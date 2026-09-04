import {loadPlanFromText} from "@tableau/query-graphs/lib/loaders/plan";
import type {TreeDescription} from "@tableau/query-graphs/lib/tree-description";

export function loadPlan(plan: string): TreeDescription {
    return loadPlanFromText(plan);
}
