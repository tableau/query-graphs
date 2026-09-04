import type {TreeDescription} from "../tree-description";
import type {Json} from "./loader-utils";
import {loadDuckDbPlan} from "./duckdb";
import {loadHyperPlan} from "./hyper";
import {loadJson} from "./json";
import {loadPostgresPlan} from "./postgres";
import {loadTableauPlan} from "./tableau";
import {loadUmbraPlan} from "./umbra";
import {loadXml} from "./xml";

export type PlanFormat = "postgres" | "umbra" | "duckdb" | "hyper" | "json" | "tableau" | "xml";

export interface LoadedPlan {
    format: PlanFormat;
    tree: TreeDescription;
}

interface JsonPlanLoader {
    format: PlanFormat;
    load(json: Json): TreeDescription;
}

interface TextPlanLoader {
    format: PlanFormat;
    load(text: string): TreeDescription;
}

const jsonPlanLoaders: JsonPlanLoader[] = [
    {format: "postgres", load: loadPostgresPlan},
    {format: "umbra", load: loadUmbraPlan},
    {format: "duckdb", load: loadDuckDbPlan},
    {format: "hyper", load: loadHyperPlan},
];

const xmlPlanLoaders: TextPlanLoader[] = [
    {format: "tableau", load: loadTableauPlan},
    {format: "xml", load: loadXml},
];

export function loadPlanFromTextWithFormat(text: string): LoadedPlan {
    const errors: string[] = [];
    let json: Json | undefined;
    try {
        const jsonText = text.startsWith("plan\n") ? text.substring("plan\n".length) : text;
        json = JSON.parse(jsonText) as Json;
    } catch (error) {
        errors.push(`JSON parse failed with '${String(error)}'.`);
    }

    if (json !== undefined) {
        for (const loader of jsonPlanLoaders) {
            try {
                return {format: loader.format, tree: loader.load(json)};
            } catch (error) {
                errors.push(String(error));
            }
        }
        return {format: "json", tree: loadJson(json)};
    }

    for (const loader of xmlPlanLoaders) {
        try {
            return {format: loader.format, tree: loader.load(text)};
        } catch (error) {
            errors.push(String(error));
        }
    }

    const uniqueErrors = Array.from(new Set(errors));
    throw new Error("Not a valid query plan:\n" + uniqueErrors.map((error) => `\n${error}`).join(""));
}

export function loadPlanFromText(text: string): TreeDescription {
    return loadPlanFromTextWithFormat(text).tree;
}
