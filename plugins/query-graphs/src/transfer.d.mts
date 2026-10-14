export function resultData(result: unknown): unknown;
export function readDocumentText(
    app: {callServerTool(args: {name: string; arguments: Record<string, unknown>}): Promise<unknown>},
    handle: string,
    document: "plan" | "sql",
    totalBytes: number,
    chunkBytes?: number,
): Promise<string>;
