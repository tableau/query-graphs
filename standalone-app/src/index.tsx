import React, {useEffect, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";
import {useBrowserUrl, useUrlParam} from "./browserUrlHooks";
import {FileOpener, FileOpenerData, useLoadStateController} from "./FileOpener";
import {QueryGraph} from "@tableau/query-graphs/lib/QueryGraph";
import {TreeDescription} from "@tableau/query-graphs/lib/tree-description";
import {loadPlan} from "./tree-loader";
import {tryCreateLocalStorageUrl, isLocalStorageURL, loadLocalStorageURL} from "./LocalStorageUrl";
import {assert} from "./assert";

import "./index.css";
import "bootstrap/dist/css/bootstrap.min.css";

function shortenPathName(path: string) {
    const parts = path.split("/");
    let shortened = parts.pop() as string;
    while (parts.length && shortened.length + parts[parts.length - 1].length < 30) {
        shortened = parts.pop() + "/" + shortened;
    }
    return shortened;
}

function App() {
    const loadStateController = useLoadStateController();
    const {setProgress, clearLoadState, tryAndDisplayErrors} = loadStateController;
    const [tree, setTree] = useState<TreeDescription | undefined>(undefined);
    const browserUrl = useBrowserUrl();
    // We store the currently opened tree in a URL parameter.
    // Thereby, we automatically integrate with the browser's history.
    const [treeUrl, setTreeUrl] = useUrlParam(browserUrl, "file");
    const [treeTitle, setTreeTitle] = useUrlParam(browserUrl, "title");
    const [debugMode] = useUrlParam(browserUrl, "DEBUG");
    const [uploadServer] = useUrlParam(browserUrl, "uploadServer");
    // Callback for the file opener
    const openPickedData = async (data: FileOpenerData): Promise<void> => {
        let url = data.url;
        const content = data.content;
        if (!url && uploadServer) {
            assert(content);
            // Replace `blob` URLs by shareable URLs
            try {
                const uploadResult = await fetch(uploadServer, {
                    method: "PUT",
                    body: content,
                });
                assert(uploadResult.ok);
                url = new URL(await uploadResult.text());
            } catch (e) {
                throw new Error(`Upload to ${uploadServer} failed!`);
            }
        }
        if (!url) {
            // Replace `blob` URLs by local storage URLs to ensure
            // we can open the file after a page reload.
            assert(content);
            url = tryCreateLocalStorageUrl(content);
        }
        if (!url) {
            // Last resort: Use a `blob` URL
            assert(content);
            const contentBlob = new Blob([content]);
            url = new URL(URL.createObjectURL(contentBlob));
        }
        // Compute the title
        let title;
        if (data.fileName) {
            title = data.fileName;
        } else if (url.protocol == "http:" || url.protocol == "http:") {
            title = shortenPathName(url.pathname);
        } else {
            title = "query plan";
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
            let mimeType = null;
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
                mimeType = response.headers.get("Content-Type");
            }
            // Parse the tree
            setProgress("Parsing plan...");
            const tree = loadPlan(text, mimeType);
            // Display the freshly loaded tree=
            setTree(tree);
            clearLoadState();
        });
        return () => {
            abortController.abort();
        };
    }, [treeUrl, clearLoadState, setProgress, tryAndDisplayErrors]);
    // We annotate the tree with the `title`
    const annotatedTree = useMemo(() => {
        if (tree === undefined) return undefined;
        const newTree = {
            ...tree,
        };
        if (newTree.properties === undefined) {
            newTree.properties = new Map<string, string>();
        }
        if (treeTitle) {
            newTree.properties.set("title", treeTitle);
        }
        newTree.DEBUG = debugMode !== undefined;
        return newTree;
    }, [tree, treeTitle, debugMode]);

    if (!annotatedTree) {
        return <FileOpener setData={openPickedData} loadStateController={loadStateController} />;
    } else {
        return <QueryGraph treeDescription={annotatedTree} />;
    }
}

window.addEventListener("DOMContentLoaded", _event => {
    const domContainer = document.body.appendChild(document.createElement("DIV"));
    domContainer.classList.add("main-app-container");
    const root = createRoot(domContainer);
    root.render(<App />);
});

// Check that service workers are supported
if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
    // Use the window load event to keep the page load performant
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js");
    });
}
