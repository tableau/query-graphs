import {useCallback, useEffect, useId, useMemo, useState} from "react";
import {useBrowserUrl, useUrlParam} from "./browserUrlHooks";
import type {FileOpenerData} from "./FileOpener";
import {FileOpener, useLoadStateController} from "./FileOpener";
import {loadPlanFromText} from "@tableau/query-graphs/lib/loaders";
import type {LoadedPlan} from "@tableau/query-graphs/lib/loaders";
import {insightPresets} from "@tableau/query-graphs/lib/insights/presets";
import {GraphToolbar, QueryGraph} from "@tableau/query-graphs/lib/ui/QueryGraph";
import {tryCreateLocalStorageUrl} from "./LocalStorageUrl";
import {assert} from "./assert";
import {TreeLabel} from "./TreeLabel";
import {SettingsButton, SettingsPanel} from "./SettingsPanel";
import {useSettings} from "./settings";
import {useTheme} from "./theme";
import {getFileReferences, loadPlanFromFiles} from "./files";
import type {FileError} from "./files";

const emptyNamedFiles: ReadonlyMap<string, string> = new Map();

export function QueryGraphsApp() {
    const settingsPopoverId = useId();
    const animationSpeed = useSettings((settings) => settings.values.animationSpeed);
    const theme = useTheme();
    const loadStateController = useLoadStateController();
    const {setProgress, clearLoadState, setError, tryAndDisplayErrors} = loadStateController;
    const [loadedPlan, setLoadedPlan] = useState<LoadedPlan | undefined>(undefined);
    const [fileErrors, setFileErrors] = useState<FileError[]>([]);
    // Store the file collection in the URL to integrate with browser history.
    const browserUrl = useBrowserUrl();
    const [namedFiles, setNamedFiles, duplicateFiles] = useUrlParam(browserUrl, "file", {type: "map"});
    const [legacyFile, setLegacyFile, duplicateLegacyFiles] = useUrlParam(browserUrl, "file");
    const [legacySqlFile, setLegacySqlFile, duplicateLegacySqlFiles] = useUrlParam(browserUrl, "sql-file");
    const [treeTitle, setTreeTitle] = useUrlParam(browserUrl, "title", {history: "replace"});
    const [uploadServer] = useUrlParam(browserUrl, "uploadServer");
    // Stable URL hook values keep title edits out of file-load dependencies.
    const references = useMemo(
        () => getFileReferences(namedFiles ?? emptyNamedFiles, legacyFile, legacySqlFile),
        [namedFiles, legacyFile, legacySqlFile],
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
        const duplicates = [
            ...duplicateFiles,
            ...duplicateLegacyFiles.map(() => "plan.json"),
            ...duplicateLegacySqlFiles.map(() => "query.sql"),
        ];
        if (duplicates.length > 0) {
            // URL duplicates are rejected before any fetch, using the same opener error state as loader failures.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLoadedPlan(undefined);
            setFileErrors([]);
            setError(`Duplicate file name: ${duplicates[0]}`);
            return;
        }
        if (references.length === 0) {
            // Resetting here leaves the old tree visible for one extra frame after the file list clears.
            // We accept that flicker to keep `loadedPlan` as the single source of truth for the display.
            setLoadedPlan(undefined);
            setFileErrors([]);
            clearLoadState();
            return;
        }
        const abortController = new AbortController();
        const signal = abortController.signal;
        tryAndDisplayErrors(async () => {
            // Reset the tree before parsing or loading files. In case we fail,
            // we don't want an outdated tree to stay around.
            setLoadedPlan(undefined);
            setProgress("Fetching files...");
            const loaded = await loadPlanFromFiles(references, new URL(window.location.href), signal).catch((error: unknown) => {
                if (signal.aborted) return undefined;
                throw error;
            });
            if (loaded === undefined || signal.aborted) return;
            const {plan, errors} = loaded;
            setFileErrors(errors);
            // Display the freshly loaded plan.
            setLoadedPlan(plan);
            clearLoadState();
        });
        return () => {
            abortController.abort();
        };
    }, [
        references,
        duplicateFiles,
        duplicateLegacyFiles,
        duplicateLegacySqlFiles,
        clearLoadState,
        setError,
        setProgress,
        tryAndDisplayErrors,
    ]);

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

    if (!loadedPlan) {
        return <FileOpener setData={openPickedData} loadStateController={loadStateController} validate={validate} />;
    } else {
        const {tree, format} = loadedPlan;
        return (
            <QueryGraph treeDescription={tree} animationSpeed={animationSpeed} theme={theme}>
                <TreeLabel
                    title={treeTitle ?? ""}
                    setTitle={setTreeTitle}
                    metadata={tree.metadata}
                    metadataHighlighted={tree.metadataHighlighted}
                    textDocuments={tree.textDocuments}
                    fileErrors={fileErrors}
                    insights={insightPresets[format] ? {root: tree.root, definitions: insightPresets[format]} : undefined}
                />
                <SettingsPanel popoverId={settingsPopoverId} />
                <GraphToolbar>
                    <SettingsButton popoverId={settingsPopoverId} />
                </GraphToolbar>
            </QueryGraph>
        );
    }
}
