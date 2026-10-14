import {open, readFile, realpath} from "node:fs/promises";
import {constants as fsConstants} from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {McpServer} from "@modelcontextprotocol/server";
import {StdioServerTransport} from "@modelcontextprotocol/server/stdio";
import {registerAppResource, registerAppTool, RESOURCE_MIME_TYPE} from "@modelcontextprotocol/ext-apps/server";
import {z} from "zod";
import {MAX_FILE_BYTES, MAX_MCP_MESSAGE_BYTES, RESOURCE_URI, RESPONSE_ENVELOPE_HEADROOM_BYTES} from "./limits.mjs";

const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VIEW_PATH = path.join(DIST_DIR, "view.html");
const openOutputSchema = z.object({
    status: z.enum(["empty", "prepared"]),
    title: z.string(),
    planBytes: z.number().int().nonnegative(),
    sqlBytes: z.number().int().nonnegative(),
    hasSql: z.boolean(),
    format: z.string().nullable(),
});

class OpenFileError extends Error {}

function toolResult(message, metadata, privateData) {
    const result = {
        content: [{type: "text", text: message}],
        structuredContent: metadata,
        _meta: privateData,
    };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") + RESPONSE_ENVELOPE_HEADROOM_BYTES > MAX_MCP_MESSAGE_BYTES) {
        throw new OpenFileError(
            "The plan and optional SQL exceed the Query Graphs 8 MiB response budget; paste or drop the plan into the viewer to load it directly.",
        );
    }
    return result;
}

function toolError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return {isError: true, content: [{type: "text", text: message}]};
}

function normalizeOpenError(error) {
    if (error instanceof OpenFileError) return error;
    if (error?.code === "ENOENT") return new Error("The requested plan or SQL file does not exist.");
    if (error?.code === "EACCES" || error?.code === "EPERM")
        return new Error("Permission was denied while opening a requested file.");
    if (error?.code === "EISDIR" || error?.code === "ENOTDIR") return new Error("A requested path does not name a regular file.");
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[query-graphs] Unexpected local file error:", error?.stack ?? detail);
    return new Error("Could not read a requested file. See local server diagnostics for details.");
}

async function readBoundedText(filePath) {
    const file = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new OpenFileError("A requested path does not name a regular file.");
        if (!Number.isSafeInteger(stat.size)) throw new OpenFileError("File size cannot be represented safely.");
        if (stat.size > MAX_FILE_BYTES) throw new OpenFileError("A requested file exceeds the Query Graphs 8 MiB response budget.");

        const bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
            const {bytesRead} = await file.read(bytes, offset, bytes.length - offset, offset);
            if (bytesRead === 0) throw new OpenFileError("A file changed while being read; reopen it to retry.");
            offset += bytesRead;
        }
        if ((await file.stat()).size !== stat.size) throw new OpenFileError("A file changed while being read; reopen it to retry.");
        let text;
        try {
            text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
        } catch {
            throw new OpenFileError("A requested plan or SQL file is not valid UTF-8 text.");
        }
        return {text, bytes: stat.size};
    } finally {
        await file.close();
    }
}

function displayTitle(requestedTitle, planPath) {
    const rawTitle = requestedTitle ?? (planPath === undefined ? "Untitled" : path.basename(planPath));
    const safeName = rawTitle.replaceAll("\\", "/").split("/").at(-1)?.trim();
    return safeName || "Untitled";
}

export function createServer() {
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
                "Open a local query plan and optional SQL file in the interactive viewer. The app receives the private file text in result metadata; no file contents are returned to the model.",
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
                    return toolResult(
                        "Opened an empty Query Graphs viewer. No plan has been parsed or rendered.",
                        {status: "empty", title, planBytes: 0, sqlBytes: 0, hasSql: false, format: format ?? null},
                        {planText: null, sqlText: null},
                    );
                }

                const plan = await readBoundedText(path.resolve(planInput));
                const sql = sqlPath === undefined ? undefined : await readBoundedText(path.resolve(sqlPath));
                return toolResult(
                    "Prepared a query plan for the viewer. It has not yet been parsed or rendered.",
                    {
                        status: "prepared",
                        title,
                        planBytes: plan.bytes,
                        sqlBytes: sql?.bytes ?? 0,
                        hasSql: sql !== undefined,
                        format: format ?? null,
                    },
                    {planText: plan.text, sqlText: sql?.text ?? null},
                );
            } catch (error) {
                return toolError(normalizeOpenError(error));
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
