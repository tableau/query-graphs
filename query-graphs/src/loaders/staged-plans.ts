import type {Crosslink, TreeDescription, TreeNode} from "../tree-description";

export function combinePlanStages(name: string, stages: Iterable<[string, TreeDescription]>): TreeDescription {
    const children: TreeNode[] = [];
    const crosslinks: Crosslink[] = [];
    for (const [stageName, stage] of stages) {
        children.push({name: stageName, properties: stage.metadata, collapsedChildren: [stage.root]});
        crosslinks.push(...(stage.crosslinks ?? []));
    }
    return {root: {name, children}, crosslinks};
}
