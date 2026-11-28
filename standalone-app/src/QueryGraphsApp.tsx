import {useCallback, useEffect, useId, useMemo, useRef, useState} from "react";
import {useBrowserUrl, useUrlParam, useUrlMapParam} from "./browserUrlHooks";
import type {FileOpenerData} from "./FileOpener";
import {FileOpener, useLoadStateController} from "./FileOpener";
import {loadPlanFromText} from "@tableau/query-graphs/lib/loaders";
import {insightPresets} from "@tableau/query-graphs/lib/insights/presets";
import {GraphToolbar, QueryGraph} from "@tableau/query-graphs/lib/ui/QueryGraph";
import {tryCreateLocalStorageUrl} from "./LocalStorageUrl";
import {assert} from "./assert";
import {TreeLabel} from "./TreeLabel";
import {SettingsButton, SettingsPanel} from "./SettingsPanel";
import {useSettings} from "./settings";
import {useTheme} from "./theme";
import {getFileReferences, loadPlanFromFiles} from "./files";
import type {FileLoadResult, FileReference} from "./files";
import {InvalidUrl} from "./InvalidUrl";
import {removeDuplicateAppUrlEntries, validateAppUrl} from "./urlValidation";
import "./QueryGraphsApp.css";

declare const BUILD_COMMIT_HASH: string;
declare const BUILD_TIMESTAMP: string;

const emptyNamedFiles: ReadonlyMap<string, string> = new Map();

const sameReferences = (a: readonly FileReference[], b: readonly FileReference[]) =>
    a.length === b.length &&
    a.every((item, index) => item.logicalFilename === b[index].logicalFilename && item.url === b[index].url);

export function QueryGraphsApp() {
    const settingsPopoverId = useId();
    const animationSpeed = useSettings((settings) => settings.values.animationSpeed);
    const theme = useTheme();
    const loadStateController = useLoadStateController();
    const {setProgress, clearLoadState} = loadStateController;
    const [loadResult, setLoadResult] = useState<FileLoadResult | undefined>();
    const [attempt, setAttempt] = useState(0);
    // Preserve an accepted partial result across Ignore's URL update, then consume it once.
    const retainedResult = useRef<{target: FileReference[]; result: FileLoadResult} | undefined>(undefined);
    // Store the file collection in the URL to integrate with browser history.
    const browserUrl = useBrowserUrl();
    const [namedFiles, setNamedFiles, duplicateFiles] = useUrlMapParam(browserUrl, "file");
    const [legacyFile, setLegacyFile, duplicateLegacyFiles] = useUrlParam(browserUrl, "file");
    const [legacySqlFile, setLegacySqlFile, duplicateLegacySqlFiles] = useUrlParam(browserUrl, "sql-file");
    const [treeTitle, setTreeTitle, duplicateTitles] = useUrlParam(browserUrl, "title", {history: "replace"});
    const [uploadServer, , duplicateUploadServers] = useUrlParam(browserUrl, "uploadServer");
    // Stable URL hook values keep title edits out of file-load dependencies.
    const references = useMemo(
        () => getFileReferences(namedFiles ?? emptyNamedFiles, legacyFile, legacySqlFile),
        [namedFiles, legacyFile, legacySqlFile],
    );
    const hasDuplicateLegacyFile = duplicateLegacyFiles.length > 0;
    const hasDuplicateLegacySqlFile = duplicateLegacySqlFiles.length > 0;
    const hasDuplicateTitle = duplicateTitles.length > 0;
    const hasDuplicateUploadServer = duplicateUploadServers.length > 0;
    const urlValidation = useMemo(
        () =>
            validateAppUrl(references, {
                fileNames: duplicateFiles,
                legacyFile: hasDuplicateLegacyFile,
                legacySqlFile: hasDuplicateLegacySqlFile,
                title: hasDuplicateTitle,
                uploadServer: hasDuplicateUploadServer,
            }),
        [
            references,
            duplicateFiles,
            hasDuplicateLegacyFile,
            hasDuplicateLegacySqlFile,
            hasDuplicateTitle,
            hasDuplicateUploadServer,
        ],
    );
    // Keep the browser tab's title in sync
    useEffect(() => {
        const tabTitle = treeTitle ? `${treeTitle} - QueryGraphs` : "QueryGraphs";
        document.title = tabTitle;
    }, [treeTitle]);
    // Callback for the file opener
    const openPickedData = async (data: FileOpenerData): Promise<void> => {
        const content = data.content;
        const detectedPlan = loadPlanFromText(content);
        const planLanguage = detectedPlan.tree.textDocuments?.find(({id}) => id === "plan")?.language;
        const logicalFilename = planLanguage === "xml" ? "plan.xml" : "plan.json";
        let url;
        if (uploadServer) {
            // Replace `blob` URLs by shareable URLs
            try {
                const uploadResult = await fetch(uploadServer, {
                    method: "PUT",
                    body: content,
                });
                assert(uploadResult.ok);
                url = new URL(await uploadResult.text());
            } catch (e) {
                throw new Error(`Upload to ${uploadServer} failed!`, {cause: e});
            }
        }
        if (!url) {
            // Replace `blob` URLs by local storage URLs to ensure
            // we can open the file after a page reload.
            url = tryCreateLocalStorageUrl(content);
        }
        if (!url) {
            // Last resort: Use a `blob` URL
            const contentBlob = new Blob([content]);
            url = new URL(URL.createObjectURL(contentBlob));
        }
        // Compute the title
        let title;
        if (data.fileName) {
            title = data.fileName;
        } else {
            title = new Date().toLocaleString();
        }
        // Update the tree URL such that link sharing works.
        setNamedFiles(new Map([[logicalFilename, url.toString()]]));
        setLegacyFile(undefined);
        setLegacySqlFile(undefined);
        setTreeTitle(title);
    };
    // Keep the displayed tree in sync with the named file references.
    useEffect(() => {
        if (urlValidation.errors.length > 0) {
            // Invalid URL state never starts or keeps a file load alive.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLoadResult(undefined);
            retainedResult.current = undefined;
            clearLoadState();
            return;
        }
        if (references.length === 0) {
            // Resetting here leaves the old tree visible for one extra frame after the file list clears.
            // We accept that flicker to keep `loadResult` as the single source of truth for the display.
            setLoadResult(undefined);
            retainedResult.current = undefined;
            clearLoadState();
            return;
        }
        const abortController = new AbortController();
        const signal = abortController.signal;
        if (retainedResult.current && sameReferences(retainedResult.current.target, references)) {
            const {result} = retainedResult.current;
            retainedResult.current = undefined;
            setLoadResult(result);
            clearLoadState();
            return;
        }
        retainedResult.current = undefined;
        void (async () => {
            try {
                // Reset the tree before parsing or loading files. In case we fail,
                // we don't want an outdated tree to stay around.
                setLoadResult(undefined);
                setProgress("Fetching files...");
                const loaded = await loadPlanFromFiles(references, new URL(window.location.href), signal);
                if (signal.aborted) return;
                setLoadResult(loaded);
                clearLoadState();
            } catch (error: unknown) {
                if (signal.aborted) return;
                setLoadResult({errors: [{name: "", message: error instanceof Error ? error.message : "Unknown error"}]});
                clearLoadState();
            }
        })();
        return () => {
            abortController.abort();
        };
    }, [references, urlValidation, clearLoadState, setProgress, attempt]);

    const validate = useCallback((text: string) => {
        try {
            loadPlanFromText(text);
            return undefined;
        } catch (e) {
            if (e instanceof Error) {
                return e.message;
            } else {
                return "Unknown error";
            }
        }
    }, []);

    const backToMain = () => {
        retainedResult.current = undefined;
        setLoadResult(undefined);
        clearLoadState();
        browserUrl[1]((url) => {
            const next = new URL(url);
            next.search = "";
            next.hash = "";
            return next;
        }, true);
    };

    const loading = loadStateController.loadState.state === "loading";
    const loadedPlan = loadResult?.plan;
    const fileErrors = loadResult?.errors ?? [];
    let mainContent;
    if (urlValidation.errors.length > 0) {
        mainContent = (
            <InvalidUrl
                errors={urlValidation.errors}
                canIgnoreDuplicates={urlValidation.hasDuplicates}
                onIgnoreDuplicates={() => browserUrl[1]((url) => removeDuplicateAppUrlEntries(url), true)}
                onStartOver={backToMain}
            />
        );
    } else if (fileErrors.length > 0 || (loadResult && !loadedPlan)) {
        mainContent = (
            <section className="loading-error-content" aria-labelledby="loading-error-title">
                <h1 id="loading-error-title">Unable to load files</h1>
                <ul className="loading-errors">
                    {fileErrors.map(({name, message}, index) => (
                        <li key={`${name}-${index}`}>
                            {name && (
                                <>
                                    <strong>{name}:</strong>{" "}
                                </>
                            )}
                            {message}
                        </li>
                    ))}
                </ul>
                {!loadedPlan && (
                    <p>A usable query plan is required to continue. Retry loading the files or return to the main page.</p>
                )}
                <div className="loading-error-actions">
                    <button
                        type="button"
                        onClick={() => {
                            retainedResult.current = undefined;
                            setLoadResult(undefined);
                            setAttempt((n) => n + 1);
                        }}
                    >
                        Retry
                    </button>
                    <button
                        type="button"
                        disabled={!loadedPlan}
                        onClick={() => {
                            const failedNames = new Set(fileErrors.map(({name}) => name));
                            const surviving = references.filter(({logicalFilename}) => !failedNames.has(logicalFilename));
                            const kept = new Map(surviving.map(({logicalFilename, url}) => [logicalFilename, url]));
                            retainedResult.current = loadedPlan
                                ? {target: surviving, result: {plan: loadedPlan, errors: []}}
                                : undefined;
                            setNamedFiles(kept);
                            // Convert remaining legacy references to named files so the retained result matches URL state.
                            setLegacyFile(undefined);
                            setLegacySqlFile(undefined);
                        }}
                    >
                        Ignore unloadable files
                    </button>
                    <button type="button" onClick={backToMain}>
                        Back to main page
                    </button>
                </div>
            </section>
        );
    } else if (!loadedPlan) {
        mainContent = (
            <div className="file-opener-slot">
                <div inert={loading} aria-hidden={loading}>
                    <FileOpener setData={openPickedData} loadStateController={loadStateController} validate={validate} />
                </div>
                {loading && (
                    <div className="loading-overlay" role="status">
                        <span className="qg-spinner" aria-hidden="true" />
                        {loadStateController.loadState.detail ?? "Loading query plan…"}
                    </div>
                )}
            </div>
        );
    }
    if (loadedPlan && fileErrors.length === 0 && urlValidation.errors.length === 0) {
        return (
            <QueryGraph treeDescription={loadedPlan.tree} animationSpeed={animationSpeed} theme={theme}>
                <TreeLabel
                    title={treeTitle ?? ""}
                    setTitle={setTreeTitle}
                    metadata={loadedPlan.tree.metadata}
                    metadataHighlighted={loadedPlan.tree.metadataHighlighted}
                    textDocuments={loadedPlan.tree.textDocuments}
                    insights={
                        insightPresets[loadedPlan.format]
                            ? {root: loadedPlan.tree.root, definitions: insightPresets[loadedPlan.format]}
                            : undefined
                    }
                />
                <SettingsPanel popoverId={settingsPopoverId} />
                <GraphToolbar>
                    <SettingsButton popoverId={settingsPopoverId} />
                </GraphToolbar>
            </QueryGraph>
        );
    }
    return (
        <div className="file-selection-page">
            <div className="caption">
                <img className="logo" src="query-graphs-logo.svg" alt="" />
                Query Graphs
            </div>
            {!urlValidation.errors.length && !loadResult && (
                <div className="subcaption">Which query plan do you want to visualize?</div>
            )}
            <main className="qg-landing-main">{mainContent}</main>
            <footer className="landing-footer">
                <div className="github-link">
                    Open-sourced on <a href="https://github.com/tableau/query-graphs">Github</a>
                </div>
                <div className="build-info">
                    Commit {BUILD_COMMIT_HASH.substring(0, 12)} · {BUILD_TIMESTAMP}
                </div>
            </footer>
        </div>
    );
}
