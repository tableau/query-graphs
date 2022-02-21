import React, {useEffect, useMemo, useState} from "react";
import ReactDOM from "react-dom";
import {useUrlParam} from "./useUrlParam";
import {FileOpener, FileOpenerData, useLoadStateController} from "./FileOpener";
import {QueryGraphViz} from "./QueryGraphViz";
import {TreeDescription} from "@tableau/query-graphs/lib/tree-description";
import {loadPlan} from "./tree-loader";
import {createLocalStorageUrlFor, isLocalStorageURL, loadLocalStorageURL} from "./LocalStorageUrl";

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
    const [treeTitle, setTreeTitle] = useUrlParam("title");
    // We store the currently opened tree in a URL parameter.
    // Thereby, we automatically integrate with the browser's history.
    // We distinguish between the loaded URL and the displayed URL.
    // This allows us to, e.g., swap out URLs without reloading the tree.
    const [treeUrl, setTreeUrl] = useUrlParam("file");
    const [loadedTreeUrl, setLoadedTreeUrl] = useState<string>();
    // Load a tree and update `treeUrl`, `loadedTreeUrl` accordingly
    const loadTree = async (urlString: string) => {
        const url = new URL(urlString);
        // Reset the tree. In case we fail due to an exception, we don't want
        // an outdated tree to stay around.
        setTree(undefined);
        // Eagerly set the "loaded url" to avoid re-loads while this
        // download is still in flight.
        setLoadedTreeUrl(urlString);
        // Update the tree URL referenced in our own URL, such that link sharing
        // works.
        // TODO: Don't create an entry in the browser history, yet. Only do so after
        // successfully loading the tree. We don't want history entries for unloadable
        // trees.
        setTreeUrl(urlString);
        // Load the URL
        let text;
        let mimeType = null;
        if (isLocalStorageURL(url)) {
            text = loadLocalStorageURL(url);
        } else {
            setProgress(`Fetching "${urlString}"...`);
            let response;
            try {
                response = await fetch(urlString);
            } catch (e) {
                if (url.protocol == "blob:") {
                    console.log(e);
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
        // Display the freshly loaded tree
        setTree(tree);
    };
    // Callback for the file opener
    const openPickedData = async (data: FileOpenerData) => {
        let url = data.url;
        if (url.protocol == "blob:") {
            // Replace `blob` URLs by local storage URLs to ensure
            // we can open the file after a page reload.
            url = await createLocalStorageUrlFor(url);
        }
        // Load the tree
        await loadTree(url.toString());
        // Set the title
        let title;
        if (data.fileName) {
            title = data.fileName;
        } else if (data.url.protocol != "data:") {
            title = shortenPathName(data.url.pathname);
        } else {
            title = "query plan";
        }
        setTreeTitle(title);
    };
    // We keep the displayed tree in sync with the URL parameter
    useEffect(() => {
        if (loadedTreeUrl == treeUrl) return;
        tryAndDisplayErrors(async () => {
            setTree(undefined);
            if (!treeUrl) {
                return;
            }
            // Also interpret relative URLs. This is important such that the "examples.html"
            // page works correctly.
            const absoluteUrl = new URL(treeUrl, window.location.href).toString();
            await loadTree(absoluteUrl);
            clearLoadState();
        });
    });
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
        return newTree;
    }, [tree, treeTitle]);

    if (!annotatedTree) {
        return <FileOpener setData={openPickedData} loadStateController={loadStateController} />;
    } else {
        return <QueryGraphViz treeDescription={annotatedTree} />;
    }
}

window.addEventListener("DOMContentLoaded", _event => {
    const domContainer = document.querySelector("#main");
    ReactDOM.render(<App />, domContainer);
});
