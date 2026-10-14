import {createRoot} from "react-dom/client";
import {useCallback, useEffect, useRef, useState} from "react";
import {App} from "@modelcontextprotocol/ext-apps";
import {loadPlanFromText} from "@tableau/query-graphs/lib/loaders";
import type {LoadedPlan} from "@tableau/query-graphs/lib/loaders";
import {allChildren} from "@tableau/query-graphs/lib/tree-description";
import {ErrorBoundary} from "../../../standalone-app/src/ErrorBoundary";
import {FileOpener, useLoadStateController} from "../../../standalone-app/src/FileOpener";
import type {FileOpenerData} from "../../../standalone-app/src/FileOpener";
import {PlanView} from "../../../standalone-app/src/PlanView";
import {ThemeContext, useResolvedThemeSetting} from "../../../standalone-app/src/theme";
import {readDocumentText, resultData} from "./transfer.mjs";
import {setupDisplayControls} from "./display.mjs";
import {MAX_CHUNK_BYTES, MAX_FILE_BYTES} from "./limits.mjs";

import "bootstrap/dist/css/bootstrap-reboot.min.css";
import "../../../standalone-app/src/index.css";
import "../../../standalone-app/src/plugin.css";

const app = new App(
    {name: "Query Graphs", version: __QUERY_GRAPHS_VERSION__},
    {availableDisplayModes: ["fullscreen", "inline"]},
    {autoResize: false},
);
const pluginShell = document.getElementById("plugin-shell")!;
const display = setupDisplayControls(
    app,
    document.getElementById("expand") as HTMLButtonElement,
    document.getElementById("display-error")!,
);

function nodeCount(plan: LoadedPlan): number {
    let count = 0;
    const pending = [plan.tree.root];
    while (pending.length > 0) {
        const node = pending.pop()!;
        count += 1;
        pending.push(...allChildren(node));
    }
    return count;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function PluginApp() {
    const [hostTheme, setHostTheme] = useState<"light" | "dark">();
    const theme = useResolvedThemeSetting(hostTheme);
    useEffect(() => {
        pluginShell.dataset.theme = theme;
    }, [theme]);
    const generation = useRef(0);
    const [loadedPlan, setLoadedPlan] = useState<LoadedPlan>();
    const [title, setTitle] = useState("Untitled");
    const [status, setStatus] = useState("Paste or drop a query plan, or open one with open_query_plan.");
    const [error, setError] = useState<string>();
    const loadStateController = useLoadStateController();

    const validate = useCallback((text: string) => {
        try {
            loadPlanFromText(text);
            return undefined;
        } catch (cause) {
            return errorText(cause);
        }
    }, []);

    const openPickedData = useCallback(async (data: FileOpenerData) => {
        const current = ++generation.current;
        setError(undefined);
        setStatus("Parsing query plan…");
        try {
            const plan = loadPlanFromText(data.content);
            if (current !== generation.current) return;
            setLoadedPlan(plan);
            setTitle(data.fileName ?? "Untitled");
            setStatus(`Loaded ${plan.format} query plan (${nodeCount(plan)} nodes).`);
        } catch (cause) {
            if (current === generation.current) setError(errorText(cause));
            throw cause;
        }
    }, []);

    useEffect(() => {
        const handleToolResult = async (result: unknown) => {
            const current = ++generation.current;
            setError(undefined);
            setStatus("Preparing query plan…");
            try {
                const metadata = resultData(result) as {
                    status?: unknown;
                    title?: unknown;
                    handle?: unknown;
                    planBytes?: unknown;
                    sqlBytes?: unknown;
                    hasSql?: unknown;
                    format?: unknown;
                    chunkBytes?: unknown;
                };
                if (metadata.status === "empty") {
                    if (current !== generation.current) return;
                    setLoadedPlan(undefined);
                    setTitle(typeof metadata.title === "string" ? metadata.title : "Untitled");
                    setStatus("Paste or drop a query plan, or open one with open_query_plan.");
                    return;
                }
                if (metadata.status !== "prepared" || typeof metadata.handle !== "string" || typeof metadata.title !== "string") {
                    throw new Error("The open tool returned invalid snapshot metadata.");
                }
                const {planBytes, sqlBytes, hasSql, format, chunkBytes} = metadata;
                if (
                    !Number.isSafeInteger(planBytes) ||
                    (planBytes as number) < 0 ||
                    (planBytes as number) > MAX_FILE_BYTES ||
                    !Number.isSafeInteger(sqlBytes) ||
                    (sqlBytes as number) < 0 ||
                    (sqlBytes as number) > MAX_FILE_BYTES ||
                    typeof hasSql !== "boolean" ||
                    (!hasSql && sqlBytes !== 0) ||
                    typeof chunkBytes !== "number" ||
                    chunkBytes < 1 ||
                    chunkBytes > MAX_CHUNK_BYTES ||
                    (format !== null && typeof format !== "string")
                ) {
                    throw new Error("The open tool returned invalid file metadata.");
                }
                const [planText, sqlText] = await Promise.all([
                    readDocumentText(app, metadata.handle, "plan", planBytes as number, chunkBytes),
                    hasSql
                        ? readDocumentText(app, metadata.handle, "sql", sqlBytes as number, chunkBytes)
                        : Promise.resolve(undefined),
                ]);
                if (current !== generation.current) return;
                const plan = loadPlanFromText(planText, {
                    format: format ?? undefined,
                    sql: sqlText,
                });
                if (current !== generation.current) return;
                setLoadedPlan(plan);
                setTitle(metadata.title);
                setStatus(`Loaded ${plan.format} query plan (${nodeCount(plan)} nodes).`);
            } catch (cause) {
                if (current === generation.current) setError(errorText(cause));
            }
        };

        app.ontoolresult = (result) => void handleToolResult(result);
        app.ontoolcancelled = () => {
            generation.current += 1;
            setError("Opening the query plan was cancelled.");
        };
        const updateDisplayControls = app.onhostcontextchanged;
        app.onhostcontextchanged = (context) => {
            updateDisplayControls?.(context);
            if (Object.hasOwn(context, "theme")) setHostTheme(context.theme);
        };
        void app
            .connect()
            .then(async () => {
                setHostTheme(app.getHostContext()?.theme);
                await display.ready();
            })
            .catch((cause: unknown) => setError(errorText(cause)));
        return () => {
            generation.current += 1;
            app.ontoolresult = undefined;
            app.ontoolcancelled = undefined;
            app.onhostcontextchanged = undefined;
        };
    }, []);

    return (
        <div className="main-app-container qg-theme" data-theme={theme}>
            <ThemeContext.Provider value={theme}>
                <ErrorBoundary>
                    {loadedPlan ? (
                        <PlanView loadedPlan={loadedPlan} title={title} setTitle={setTitle} />
                    ) : (
                        <FileOpener setData={openPickedData} validate={validate} loadStateController={loadStateController} />
                    )}
                    <div className={`qg-plugin-status${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
                        {error ?? status}
                    </div>
                </ErrorBoundary>
            </ThemeContext.Provider>
        </div>
    );
}

createRoot(document.getElementById("root")!).render(<PluginApp />);
