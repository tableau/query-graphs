import {loadPostgresPlanFromText} from "@tableau/query-graphs/lib/postgres";
import {loadUmbraPlanFromText} from "@tableau/query-graphs/lib/umbra";
import {loadHyperPlanFromText} from "@tableau/query-graphs/lib/hyper";
import {loadTableauPlan} from "@tableau/query-graphs/lib/tableau";
import {loadJsonFromText} from "@tableau/query-graphs/lib/json";
import {loadXml} from "@tableau/query-graphs/lib/xml";
import {TreeDescription} from "@tableau/query-graphs/lib/tree-description";
import {assert} from "./assert";

export function loadPlan(plan: string): TreeDescription {
    // Postgres and Umbra/CedarDB both validate their envelope strictly and throw on anything
    // else. Hyper's loader is deliberately permissive (it falls back to rendering *something*
    // for unrecognized JSON), so it must be tried last among the JSON-based loaders, or it
    // would swallow Postgres/Umbra/CedarDB plans before they get a chance.
    const loaders = [
        loadPostgresPlanFromText,
        loadUmbraPlanFromText,
        loadHyperPlanFromText,
        loadJsonFromText,
        loadTableauPlan,
        loadXml,
    ];
    const errors: string[] = [];
    let loadedTree: TreeDescription | undefined;
    function tryLoad(loader: any) {
        try {
            loadedTree = loader(plan);
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
    return loadedTree;
}
