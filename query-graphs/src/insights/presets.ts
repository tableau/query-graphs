import type {CategoricalInsightDefinition} from "./categorical";

export const insightPresets: Readonly<Record<string, readonly CategoricalInsightDefinition[]>> = {
    hyper: [
        {
            id: "scan-types",
            title: "Scan types",
            where: {property: "operator", equals: "scan"},
            groupBy: "type",
        },
    ],
};
