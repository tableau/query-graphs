import {useCallback, useEffect, useState} from "react";
import {useBrowserUrl, useUrlParam} from "./browserUrlHooks";
import {FileOpener, FileOpenerData, useLoadStateController} from "./FileOpener";
import {QueryGraph} from "@tableau/query-graphs/lib/ui/QueryGraph";
import {TreeDescription} from "@tableau/query-graphs/lib/tree-description";
import {loadPlan} from "./tree-loader";
import {tryCreateLocalStorageUrl, isLocalStorageURL, loadLocalStorageURL} from "./LocalStorageUrl";
import {assert} from "./assert";
import {TreeLabel} from "./TreeLabel";

export function QueryGraphsApp() {
    const loadStateController = useLoadStateController();
    const {setProgress, clearLoadState, tryAndDisplayErrors} = loadStateController;
    const [tree, setTree] = useState<TreeDescription | undefined>(undefined);
    const browserUrl = useBrowserUrl();
    // We store the currently opened tree in a URL parameter.
    // Thereby, we automatically integrate with the browser's history.
    const [treeUrl, setTreeUrl] = useUrlParam(browserUrl, "file");
    const [treeTitle, setTreeTitle] = useUrlParam(browserUrl, "title", true);
    const [uploadServer] = useUrlParam(browserUrl, "uploadServer");
    // Callback for the file opener
    const openPickedData = async (data: FileOpenerData): Promise<void> => {
        const content = data.content;
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
            } catch (_e) {
                throw new Error(`Upload to ${uploadServer} failed!`);
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
        setTreeTitle(title);
        setTreeUrl(url.toString());
    };
    // We keep the displayed tree in sync with the URL parameter
    useEffect(() => {
        if (!treeUrl) {
            setTree(undefined);
            return;
        }
        const abortController = new AbortController();
        const signal = abortController.signal;
        tryAndDisplayErrors(async () => {
            // Interpret relative URLs. This is important such that
            // the "examples.html" page works correctly.
            const url = new URL(treeUrl, window.location.href);
            const urlString = url.toString();
            // Reset the tree. In case we fail due to an exception, we don't want
            // an outdated tree to stay around.
            setTree(undefined);
            // Load the URL
            let text;
            if (isLocalStorageURL(url)) {
                text = loadLocalStorageURL(url);
            } else {
                setProgress(`Fetching "${urlString}"...`);
                let response;
                try {
                    response = await fetch(urlString, {signal});
                } catch (e) {
                    if (url.protocol == "blob:") {
                        throw new Error("Local content no longer accessible");
                    }
                    throw e;
                }
                if (!response.ok) {
                    throw new Error(`Failed to load ${urlString}: HTTP ${response.status}`);
                }
                text = await response.text();
            }
            // Parse the tree
            setProgress("Parsing plan...");
            const tree = loadPlan(text);
            // Display the freshly loaded tree=
            setTree(tree);
            clearLoadState();
        });
        return () => {
            abortController.abort();
        };
    }, [treeUrl, clearLoadState, setProgress, tryAndDisplayErrors]);

    const validate = useCallback((text: string) => {
        try {
            loadPlan(text);
            return undefined;
        } catch (e) {
            if (e instanceof Error) {
                return e.message;
            } else {
                return "Unknown error";
            }
        }
    }, []);

    if (!tree) {
        return <FileOpener setData={openPickedData} loadStateController={loadStateController} validate={validate} />;
    } else {
        return (
            <QueryGraph treeDescription={tree}>
                <TreeLabel title={treeTitle ?? ""} setTitle={setTreeTitle} />
            </QueryGraph>
        );
    }
}
