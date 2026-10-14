import {open, readFile, realpath} from "node:fs/promises";
import {constants as fsConstants} from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {McpServer} from "@modelcontextprotocol/server";
import {StdioServerTransport} from "@modelcontextprotocol/server/stdio";
import {registerAppResource, registerAppTool, RESOURCE_MIME_TYPE} from "@modelcontextprotocol/ext-apps/server";
import {z} from "zod";
import {MAX_CHUNK_BYTES, MAX_FILE_BYTES, RESOURCE_URI} from "./limits.mjs";
import {SnapshotError, SnapshotStore} from "./snapshot-store.mjs";

const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VIEW_PATH = path.join(DIST_DIR, "view.html");
const openOutputSchema = z.object({
    status: z.enum(["empty", "prepared"]),
    title: z.string(),
    handle: z.string().nullable(),
    planBytes: z.number().int().nonnegative(),
    sqlBytes: z.number().int().nonnegative(),
    hasSql: z.boolean(),
    format: z.string().nullable(),
    chunkBytes: z.number().int().positive(),
});
const chunkOutputSchema = z.object({
    offset: z.number().int().nonnegative(),
    length: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    base64: z.string(),
});

class OpenFileError extends Error {}

function toolResult(message, data) {
    return {content: [{type: "text", text: message}], structuredContent: data};
}

function toolError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return {isError: true, content: [{type: "text", text: message}]};
}

function normalizeOpenError(error) {
    if (error instanceof OpenFileError || error instanceof SnapshotError) return error;
    if (error?.code === "ENOENT") return new Error("The requested plan or SQL file does not exist.");
    if (error?.code === "EACCES" || error?.code === "EPERM")
        return new Error("Permission was denied while opening a requested file.");
    if (error?.code === "EISDIR" || error?.code === "ENOTDIR") return new Error("A requested path does not name a regular file.");
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[query-graphs] Unexpected local file error:", error?.stack ?? detail);
    return new Error("Could not read a requested file. See local server diagnostics for details.");
}

async function readSnapshot(filePath) {
    const file = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new OpenFileError("A requested path does not name a regular file.");
        if (!Number.isSafeInteger(stat.size)) throw new OpenFileError("File size cannot be represented safely.");
        if (stat.size > MAX_FILE_BYTES) throw new OpenFileError(`Each file must be at most ${MAX_FILE_BYTES} bytes.`);
        const bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
            const {bytesRead} = await file.read(bytes, offset, bytes.length - offset, offset);
            if (bytesRead === 0) throw new OpenFileError("A file changed while being read; reopen it to retry.");
            offset += bytesRead;
        }
        return bytes;
    } finally {
        await file.close();
    }
}

function displayTitle(requestedTitle, planPath) {
    const rawTitle = requestedTitle ?? (planPath === undefined ? "Untitled" : path.basename(planPath));
    const safeName = rawTitle.replaceAll("\\", "/").split("/").at(-1)?.trim();
    return safeName || "Untitled";
}

export function createServer({snapshotStore = new SnapshotStore()} = {}) {
    const server = new McpServer({name: "query-graphs", version: __QUERY_GRAPHS_VERSION__});
    const appMetadata = {
        ui: {csp: {resourceDomains: [], connectDomains: []}},
        "openai/ui": {availableDisplayModes: ["fullscreen", "inline"], preferredDisplayMode: "fullscreen"},
    };

    registerAppTool(
        server,
        "open_query_plan",
        {
            title: "Open a query plan",
            description:
                "Prepare a local query plan and optional SQL file for the interactive Query Graphs viewer. Omit path to open the empty viewer; file contents stay local and are transferred to the app in bounded chunks.",
            inputSchema: z.object({
                path: z.string().min(1).optional(),
                sqlPath: z.string().min(1).optional(),
                format: z.string().min(1).optional(),
                title: z.string().min(1).optional(),
            }),
            outputSchema: openOutputSchema,
            annotations: {readOnlyHint: true, openWorldHint: false},
            _meta: {ui: {resourceUri: RESOURCE_URI}, "openai/ui": {preferredModelDisplayMode: "fullscreen"}},
        },
        async ({path: planInput, sqlPath, format, title: requestedTitle}) => {
            try {
                if (sqlPath !== undefined && planInput === undefined) throw new OpenFileError("sqlPath requires a plan path.");
                const title = displayTitle(requestedTitle, planInput);
                if (planInput === undefined) {
                    return toolResult("Opened an empty Query Graphs viewer. No plan has been parsed or rendered.", {
                        status: "empty",
                        title,
                        handle: null,
                        planBytes: 0,
                        sqlBytes: 0,
                        hasSql: false,
                        format: format ?? null,
                        chunkBytes: MAX_CHUNK_BYTES,
                    });
                }

                const planPath = path.resolve(planInput);
                const planBytes = await readSnapshot(planPath);
                const sqlBytes = sqlPath === undefined ? undefined : await readSnapshot(path.resolve(sqlPath));
                const snapshot = snapshotStore.create(title, planBytes, sqlBytes);
                return toolResult(
                    `Prepared ${title} for the Query Graphs viewer. The app will parse the plan; it has not yet been rendered.`,
                    {
                        status: "prepared",
                        title: snapshot.title,
                        handle: snapshot.handle,
                        planBytes: snapshot.planBytes,
                        sqlBytes: snapshot.sqlBytes,
                        hasSql: sqlPath !== undefined,
                        format: format ?? null,
                        chunkBytes: MAX_CHUNK_BYTES,
                    },
                );
            } catch (error) {
                return toolError(normalizeOpenError(error));
            }
        },
    );

    registerAppTool(
        server,
        "read_plan_chunk",
        {
            title: "Read a query plan snapshot chunk",
            description: "Read a bounded byte range from a plan or SQL snapshot already prepared for this app.",
            inputSchema: z.object({
                handle: z.string().min(1),
                document: z.enum(["plan", "sql"]),
                offset: z.number().int().min(0),
                length: z.number().int().min(1).max(MAX_CHUNK_BYTES),
            }),
            outputSchema: chunkOutputSchema,
            annotations: {readOnlyHint: true, openWorldHint: false},
            _meta: {ui: {resourceUri: RESOURCE_URI, visibility: ["app"]}},
        },
        async ({handle, document, offset, length}) => {
            try {
                const chunk = snapshotStore.readChunk(handle, document, offset, length);
                return toolResult(`Read ${chunk.length} bytes at offset ${chunk.offset}.`, chunk);
            } catch (error) {
                return toolError(error);
            }
        },
    );

    registerAppResource(
        server,
        "Query Graphs UI",
        RESOURCE_URI,
        {description: "Self-contained Query Graphs interactive plan viewer.", _meta: appMetadata},
        async () => ({
            contents: [
                {uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: await readFile(VIEW_PATH, "utf8"), _meta: appMetadata},
            ],
        }),
    );

    return server;
}

export async function startServer() {
    const server = createServer();
    await server.connect(new StdioServerTransport());
}

const invokedPath = process.argv[1] === undefined ? undefined : await realpath(process.argv[1]).catch(() => undefined);
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) await startServer();
