import type {CategoricalInsightDefinition, CategoricalInsightLevel} from "./categorical";

const hyperTableCategorization: CategoricalInsightLevel = {
    // External scans carry table-name; native scans carry debug-name.value.
    valueSourceAlternatives: [["table-name"], ["debug-name", "value"]],
    fallbackValue: "Unknown table",
};

const umbraTableCategorization: CategoricalInsightLevel = {
    valueSourceAlternatives: [["tablename"]],
    fallbackValue: "Unknown table",
};

const postgresTableCategorization: CategoricalInsightLevel = {
    valueSourceAlternatives: [["Relation Name"]],
    fallbackValue: "Unknown table",
};

const duckdbTableCategorization: CategoricalInsightLevel = {
    valueSourceAlternatives: [["Table"], ["File"]],
    fallbackValue: "Unknown table",
};

export const insightPresets: Readonly<Record<string, readonly CategoricalInsightDefinition[]>> = {
    hyper: [
        {
            id: "table-names",
            title: "Scanned Tables",
            where: {op: "equals", path: ["operator"], value: "scan"},
            groupBy: hyperTableCategorization,
        },
        {
            id: "operators",
            title: "Operators",
            where: {op: "exists", path: ["operator"]},
            groupBy: {
                valueSourceAlternatives: [["operator"]],
                fallbackValue: "Unknown operator",
                nextByValue: {
                    scan: {
                        valueSourceAlternatives: [["type"]],
                        fallbackValue: "Unknown storage",
                        next: hyperTableCategorization,
                    },
                    join: {valueSourceAlternatives: [["type"]], fallbackValue: "Unknown type"},
                },
            },
        },
        {
            id: "expressions",
            title: "Expressions",
            where: {op: "exists", path: ["expression"]},
            groupBy: {
                valueSourceAlternatives: [["expression"]],
                fallbackValue: "Unknown expression",
                nextByValue: {comparison: {valueSourceAlternatives: [["mode"]], fallbackValue: "Unknown comparison"}},
            },
        },
    ],
    umbra: [
        {
            id: "table-names",
            title: "Scanned Tables",
            where: {op: "equals", path: ["operator"], value: "tablescan"},
            groupBy: umbraTableCategorization,
        },
        {
            id: "operators",
            title: "Operators",
            where: {op: "exists", path: ["operator"]},
            groupBy: {
                valueSourceAlternatives: [["operator"]],
                fallbackValue: "Unknown operator",
                nextByValue: {
                    join: {valueSourceAlternatives: [["type"]], fallbackValue: "Unknown type"},
                    setoperation: {valueSourceAlternatives: [["operation"]], fallbackValue: "Unknown operation"},
                    tablescan: umbraTableCategorization,
                },
            },
        },
        {
            id: "expressions",
            title: "Expressions",
            where: {op: "exists", path: ["expression"]},
            groupBy: {
                valueSourceAlternatives: [["expression"]],
                fallbackValue: "Unknown expression",
                nextByValue: {compare: {valueSourceAlternatives: [["direction"]], fallbackValue: "Unknown direction"}},
            },
        },
    ],
    postgres: [
        {
            id: "table-names",
            title: "Scanned Tables",
            where: {
                op: "any",
                operands: [
                    {op: "equals", path: ["Node Type"], value: "Seq Scan"},
                    {op: "equals", path: ["Node Type"], value: "Index Scan"},
                    {op: "equals", path: ["Node Type"], value: "Index Only Scan"},
                    {op: "equals", path: ["Node Type"], value: "Bitmap Heap Scan"},
                    {op: "equals", path: ["Node Type"], value: "Tid Scan"},
                    {op: "equals", path: ["Node Type"], value: "Tid Range Scan"},
                    {op: "equals", path: ["Node Type"], value: "Sample Scan"},
                    {op: "equals", path: ["Node Type"], value: "Foreign Scan"},
                ],
            },
            groupBy: postgresTableCategorization,
        },
        {
            id: "operators",
            title: "Operators",
            where: {op: "exists", path: ["Node Type"]},
            groupBy: {
                valueSourceAlternatives: [["Node Type"]],
                fallbackValue: "Unknown operator",
                nextByValue: {
                    "Seq Scan": postgresTableCategorization,
                    "Index Scan": postgresTableCategorization,
                    "Index Only Scan": postgresTableCategorization,
                    "Bitmap Heap Scan": postgresTableCategorization,
                    "Tid Scan": postgresTableCategorization,
                    "Tid Range Scan": postgresTableCategorization,
                    "Sample Scan": postgresTableCategorization,
                    "Foreign Scan": postgresTableCategorization,
                },
            },
        },
    ],
    duckdb: [
        {
            id: "table-names",
            title: "Scanned Tables",
            where: {
                op: "any",
                operands: [
                    {op: "equals", path: ["name"], value: "SEQ_SCAN"},
                    {op: "equals", path: ["type"], value: "TABLE_SCAN"},
                ],
            },
            groupBy: duckdbTableCategorization,
        },
        {
            id: "operators",
            title: "Operators",
            where: {
                op: "any",
                operands: [
                    {op: "exists", path: ["name"]},
                    {op: "exists", path: ["type"]},
                ],
            },
            groupBy: {
                valueSourceAlternatives: [["name"], ["type"]],
                fallbackValue: "Unknown operator",
                nextByValue: {
                    SEQ_SCAN: duckdbTableCategorization,
                    TABLE_SCAN: duckdbTableCategorization,
                },
            },
        },
    ],
};
