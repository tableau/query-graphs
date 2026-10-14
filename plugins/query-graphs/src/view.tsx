import {createRoot} from "react-dom/client";
import {useCallback, useEffect, useState} from "react";
import {App} from "@modelcontextprotocol/ext-apps";
import {loadPlanFromText} from "@tableau/query-graphs/lib/loaders";
import type {LoadedPlan} from "@tableau/query-graphs/lib/loaders";
import {allChildren} from "@tableau/query-graphs/lib/tree-description";
import {ErrorBoundary} from "../../../standalone-app/src/ErrorBoundary";
import {FileOpener, useLoadStateController} from "../../../standalone-app/src/FileOpener";
import type {FileOpenerData} from "../../../standalone-app/src/FileOpener";
import {PlanView} from "../../../standalone-app/src/PlanView";
import {ThemeContext, useResolvedThemeSetting} from "../../../standalone-app/src/theme";
import {setupDisplayControls} from "./display.mjs";

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

function asRecord(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error("The open tool returned invalid data.");
    return value as Record<string, unknown>;
}

function openToolData(result: unknown) {
    const response = asRecord(result);
    if (response.isError) {
        const text = Array.isArray(response.content) ? response.content.find((item) => asRecord(item).type === "text") : undefined;
        throw new Error((text && asRecord(text).text) || "The open tool failed.");
    }
    return {metadata: asRecord(response.structuredContent), privateData: asRecord(response._meta)};
}

function PluginApp() {
    const [hostTheme, setHostTheme] = useState<"light" | "dark">();
    const theme = useResolvedThemeSetting(hostTheme);
    useEffect(() => {
        pluginShell.dataset.theme = theme;
    }, [theme]);

    const [loadedPlan, setLoadedPlan] = useState<LoadedPlan>();
    const [title, setTitle] = useState("Untitled");
    const [status, setStatus] = useState("Paste or drop a query plan, or open one with open_query_plan.");
    const [error, setError] = useState<string>();
    const loadStateController = useLoadStateController();
    const {clearLoadState, setError: setLoadError, setProgress} = loadStateController;

    const applyPlan = useCallback(
        (text: string, nextTitle: string, format?: string | null, sql?: string | null) => {
            setLoadedPlan(undefined);
            const plan = loadPlanFromText(text, {format: format ?? undefined, sql: sql ?? undefined});
            setLoadedPlan(plan);
            setTitle(nextTitle);
            setStatus(`Loaded ${plan.format} query plan (${nodeCount(plan)} nodes).`);
            setError(undefined);
            clearLoadState();
        },
        [clearLoadState],
    );

    const validate = useCallback((text: string) => {
        try {
            loadPlanFromText(text);
            return undefined;
        } catch (cause) {
            return errorText(cause);
        }
    }, []);

    const openPickedData = useCallback(
        async (data: FileOpenerData) => {
            setError(undefined);
            applyPlan(data.content, data.fileName ?? "Untitled");
        },
        [applyPlan],
    );

    const handleToolResult = useCallback(
        (result: unknown) => {
            setError(undefined);
            setProgress("Parsing query plan…");
            setStatus("Parsing query plan…");
            try {
                const {metadata, privateData} = openToolData(result);
                if (metadata.status === "empty" && typeof metadata.title === "string") {
                    setLoadedPlan(undefined);
                    setTitle(metadata.title);
                    setStatus("Paste or drop a query plan, or open one with open_query_plan.");
                    clearLoadState();
                    return;
                }
                const {status, title, planBytes, sqlBytes, hasSql, format} = metadata;
                const {planText, sqlText} = privateData;
                if (
                    status !== "prepared" ||
                    typeof title !== "string" ||
                    !Number.isSafeInteger(planBytes) ||
                    (planBytes as number) < 0 ||
                    !Number.isSafeInteger(sqlBytes) ||
                    (sqlBytes as number) < 0 ||
                    typeof hasSql !== "boolean" ||
                    (format !== null && typeof format !== "string") ||
                    typeof planText !== "string" ||
                    (hasSql ? typeof sqlText !== "string" : sqlText !== null)
                ) {
                    throw new Error("The open tool returned invalid plan data.");
                }
                applyPlan(planText, title, format as string | null, sqlText as string | null);
            } catch (cause) {
                const message = errorText(cause);
                setLoadedPlan(undefined);
                setError(message);
                setLoadError(message);
            }
        },
        [applyPlan, clearLoadState, setLoadError, setProgress],
    );

    const handleToolCancelled = useCallback(() => {
        setLoadedPlan(undefined);
        setError("Opening the query plan was cancelled.");
        setLoadError("Opening the query plan was cancelled.");
    }, [setLoadError]);

    useEffect(() => {
        app.ontoolresult = handleToolResult;
        app.ontoolcancelled = handleToolCancelled;
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
            app.ontoolresult = undefined;
            app.ontoolcancelled = undefined;
            app.onhostcontextchanged = undefined;
        };
    }, [handleToolCancelled, handleToolResult]);

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
