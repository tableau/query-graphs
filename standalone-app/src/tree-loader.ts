import {loadPostgresPlanFromText} from "@tableau/query-graphs/lib/postgres";
import {loadHyperPlanFromText} from "@tableau/query-graphs/lib/hyper";
import {loadTableauPlan} from "@tableau/query-graphs/lib/tableau";
import {loadJsonFromText} from "@tableau/query-graphs/lib/json";
import {loadXml} from "@tableau/query-graphs/lib/xml";
import {TreeDescription} from "@tableau/query-graphs/lib/tree-description";
import {assert} from "./assert";

export function loadPlan(plan: string, fileName: string | null): TreeDescription {
    let loaders;
    if (fileName && fileName.endsWith(".json")) {
        // Try Postgres before Hyper to differentiate between them
        loaders = [loadPostgresPlanFromText, loadHyperPlanFromText, loadJsonFromText];
    } else if (fileName && fileName.endsWith(".xml")) {
        loaders = [loadTableauPlan, loadXml];
    } else {
        loaders = [loadPostgresPlanFromText, loadHyperPlanFromText, loadJsonFromText, loadTableauPlan, loadXml];
    }
    const errors: string[] = [];
    let loadedTree: TreeDescription | undefined;
    function tryLoad(loader: any) {
        try {
            const graphCollapse = undefined;
            loadedTree = loader(plan, graphCollapse);
            return true;
        } catch (err : any) { // eslint-disable-line  prettier/prettier
            errors.push(err.toString());
            return false;
        }
    }
    const loaderIdx = loaders.findIndex(tryLoad);
    if (loaderIdx < 0) {
        // Different loaders frequently raise the same error, e.g. if both fail to parse the
        // text as JSON. Deduplicate to don't display duplicated error messages.
        const uniqueErrors = Array.from(new Set(errors));
        throw new Error("Not a valid query plan:\n" + uniqueErrors.reduce((a, b) => a + "\n" + b));
    }
    assert(loadedTree !== undefined);
    if (loadedTree.properties === undefined) {
        loadedTree.properties = new Map<string, string>();
    }
    if (fileName) {
        loadedTree.properties.set("fileName", fileName);
    }
    return loadedTree;
}
