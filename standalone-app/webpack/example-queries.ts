export interface ExamplesIndex {
    engines: Record<string, {queries: Record<string, Record<string, {plan: string; sql: string}>>}>;
}

export function mapPlansToSqlFiles(index: ExamplesIndex): Map<string, string> {
    const sqlFiles = new Map<string, string>();
    for (const engine of Object.values(index.engines)) {
        for (const modes of Object.values(engine.queries)) {
            for (const files of Object.values(modes)) {
                sqlFiles.set(files.plan, `examples/${files.sql}`);
            }
        }
    }
    return sqlFiles;
}

export function createExampleLink(planFile: string, title: string, sqlFile?: string): string {
    const params = new URLSearchParams({file: planFile, title});
    if (sqlFile !== undefined) params.set("sql-file", sqlFile);
    return `index.html?${params.toString()}`;
}
