import type {CategoricalInsightDefinition, CategoricalInsightLevel} from "./categorical";

const hyperTableCategorization: CategoricalInsightLevel = {
    valueSourceAlternatives: [
        {property: "table-name"},
        {property: "debug-name", jsonPath: ["value"]},
        {property: "debug-name"},
        {property: "name"},
    ],
    fallbackValue: "Unknown table",
};

const umbraTableCategorization: CategoricalInsightLevel = {
    valueSourceAlternatives: [{property: "tablename"}, {property: "name"}],
    fallbackValue: "Unknown table",
};

const postgresTableCategorization: CategoricalInsightLevel = {
    valueSourceAlternatives: [{property: "Relation Name"}, {property: "Alias"}],
    fallbackValue: "Unknown table",
};

const duckdbTableCategorization: CategoricalInsightLevel = {
    valueSourceAlternatives: [{property: "Table"}, {property: "File"}],
    fallbackValue: "Unknown table",
};

export const insightPresets: Readonly<Record<string, {insights: readonly CategoricalInsightDefinition[]}>> = {
    hyper: {
        insights: [
            {
                id: "table-names",
                title: "Scanned Tables",
                where: [{property: "operator", equals: "scan"}],
                groupBy: hyperTableCategorization,
            },
            {
                id: "operators",
                title: "Operators",
                where: [{property: "operator"}],
                groupBy: {
                    valueSourceAlternatives: [{property: "operator"}],
                    fallbackValue: "Unknown operator",
                    nextByValue: {
                        scan: {
                            valueSourceAlternatives: [{property: "type"}],
                            fallbackValue: "Unknown storage",
                            next: hyperTableCategorization,
                        },
                        join: {valueSourceAlternatives: [{property: "type"}], fallbackValue: "Unknown type"},
                        insert: {valueSourceAlternatives: [{property: "type"}], fallbackValue: "Unknown type"},
                    },
                },
            },
            {
                id: "expressions",
                title: "Expressions",
                where: [{property: "expression"}],
                groupBy: {
                    valueSourceAlternatives: [{property: "expression"}],
                    fallbackValue: "Unknown expression",
                    nextByValue: {comparison: {valueSourceAlternatives: [{property: "mode"}], fallbackValue: "Unknown comparison"}},
                },
            },
        ],
    },
    umbra: {
        insights: [
            {
                id: "table-names",
                title: "Scanned Tables",
                where: [{property: "operator", equals: "tablescan"}],
                groupBy: umbraTableCategorization,
            },
            {
                id: "operators",
                title: "Operators",
                where: [{property: "operator"}],
                groupBy: {
                    valueSourceAlternatives: [{property: "operator"}],
                    fallbackValue: "Unknown operator",
                    nextByValue: {
                        join: {valueSourceAlternatives: [{property: "type"}], fallbackValue: "Unknown type"},
                        tablescan: umbraTableCategorization,
                    },
                },
            },
            {
                id: "expressions",
                title: "Expressions",
                where: [{property: "expression"}],
                groupBy: {valueSourceAlternatives: [{property: "expression"}], fallbackValue: "Unknown expression"},
            },
        ],
    },
    postgres: {
        insights: [
            {
                id: "table-names",
                title: "Scanned Tables",
                where: [
                    {property: "Node Type", equals: "Seq Scan"},
                    {property: "Node Type", equals: "Index Scan"},
                    {property: "Node Type", equals: "Index Only Scan"},
                    {property: "Node Type", equals: "Bitmap Heap Scan"},
                    {property: "Node Type", equals: "Tid Scan"},
                    {property: "Node Type", equals: "Tid Range Scan"},
                    {property: "Node Type", equals: "Sample Scan"},
                    {property: "Node Type", equals: "Foreign Scan"},
                ],
                groupBy: postgresTableCategorization,
            },
            {
                id: "operators",
                title: "Operators",
                where: [{property: "Node Type"}],
                groupBy: {
                    valueSourceAlternatives: [{property: "Node Type"}],
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
    },
    duckdb: {
        insights: [
            {
                id: "table-names",
                title: "Scanned Tables",
                where: [
                    {property: "operator_type", equals: "TABLE_SCAN"},
                    {property: "operator_name", equals: "SEQ_SCAN"},
                    {property: "operator_name", equals: "TABLE_SCAN"},
                    {property: "operator_name", equals: "INDEX_SCAN"},
                    {property: "operator_name", equals: "PARQUET_SCAN"},
                    {property: "operator_name", equals: "CSV_SCAN"},
                    {property: "name", equals: "SEQ_SCAN"},
                    {property: "name", equals: "TABLE_SCAN"},
                    {property: "name", equals: "INDEX_SCAN"},
                    {property: "name", equals: "PARQUET_SCAN"},
                    {property: "name", equals: "CSV_SCAN"},
                ],
                groupBy: duckdbTableCategorization,
            },
            {
                id: "operators",
                title: "Operators",
                where: [{property: "operator_name"}, {property: "name"}, {property: "operator_type"}],
                groupBy: {
                    valueSourceAlternatives: [{property: "operator_name"}, {property: "name"}, {property: "operator_type"}],
                    fallbackValue: "Unknown operator",
                    nextByValue: {
                        SEQ_SCAN: duckdbTableCategorization,
                        TABLE_SCAN: duckdbTableCategorization,
                        INDEX_SCAN: duckdbTableCategorization,
                        PARQUET_SCAN: duckdbTableCategorization,
                        CSV_SCAN: duckdbTableCategorization,
                    },
                },
            },
        ],
    },
    json: {
        insights: [{id: "nodes", title: "Nodes", groupBy: {valueSourceAlternatives: [{nodeName: true}], fallbackValue: "Unnamed"}}],
    },
    xml: {
        insights: [
            {id: "elements", title: "Elements", groupBy: {valueSourceAlternatives: [{nodeName: true}], fallbackValue: "Unnamed"}},
        ],
    },
};
