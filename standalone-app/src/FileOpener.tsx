import React, {Fragment, useState} from "react";
import {useDropzone} from "react-dropzone";
import Alert from "react-bootstrap/Alert";
import objstr from "./objstr";
import Button from "react-bootstrap/Button";

import "./FileOpener.css";
import {assert} from "./assert";

function readTextFromFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result as string);
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

export interface FileOpenerData {
    content: string;
    fileName: string | null;
}

const isFirefox = /Firefox\/([0-9]+)\./.test(navigator.userAgent);

async function getTextFromPasteEvent(e : React.ClipboardEvent) : Promise<FileOpenerData> {
    if (e.clipboardData.types.indexOf("Files") !== -1) {
        if (e.clipboardData.items.length > 1) {
            if (isFirefox) {
                // Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1699743
                // Also: Firefox does not support pasting non-image files
                throw new Error("Copy-pasting files doesn't work on Firefox, yet");
            }
            throw new Error("Cannot open multiple files");
        }
        const item = e.clipboardData.items[0];
        assert(item.kind == "file");
        const f = item.getAsFile();
        if (f === null) {
            throw new Error("Unable to access pasted file");
        }
        const text = await readTextFromFile(f);
        return {content: text, fileName: f.name};
    } else {
        const items = [] as DataTransferItem[];
        Array.prototype.forEach.call(e.clipboardData.items, item => {
            items.push(item);
        });
        let foundItem: DataTransferItem | undefined;
        for (const item of items) {
            if (item.type.match("^text/plain")) {
                foundItem = item;
                break;
            }
        }
        if (foundItem !== undefined) {
            const text = (await new Promise(resolve => foundItem!.getAsString(resolve))) as string;
            return {content: text, fileName: null};
        } else {
            const typesString = items.map(e => e.type).join(", ");
            throw new Error(`None of the following types are supported: ${typesString}`);
        }
    }
}

interface FileOpenerProps {
    /// Callback called with the selected data.
    /// Might throw an `Exception` if it can't open the received file.
    setData: (data: FileOpenerData) => Promise<void>;
}

export function FileOpener({setData}: FileOpenerProps) {
    interface LoadState {
        state: "pristine" | "loading" | "error";
        detail?: string;
    }
    const [loadState, setLoadState] = useState<LoadState>({state: "pristine"});
    const [url, setUrl] = useState("https://");

    async function wrapErrorHandling(doIt: (setProgress: (msg: string) => void) => Promise<void>, errorPrefix: string) {
        try {
            const setProgress = (msg : string) => setLoadState({state: "loading", detail: msg});
            await doIt(setProgress);
        } catch (e) {
            // Show the error only after some additional time.
            // Thereby, we make sure that the spinner is visible for at least for a short moment and
            // we don't get an unpleasant "flash" in case the download fails immediately.
            await new Promise(resolve => setTimeout(resolve, 250));
            let msg;
            if (e instanceof Error) {
                msg = e.message;
            } else {
                msg = "Unknown error";
            }
            setLoadState({state: "error", detail: `${errorPrefix}: ${msg}`});
        }
    }

    async function openURL(url: string) {
        await wrapErrorHandling(async (setProgress) => {
            setProgress(`Downloading "${url}"`);
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const text = await response.text();
            await setData({content: text, fileName: url});
            setLoadState({state: "pristine"});
        }, `Unable to load "${url}"`);
    }

    const onPaste = async (e: React.ClipboardEvent) => {
        e.preventDefault();
        await wrapErrorHandling(async (_setProgress) => {
            const pastedData = await getTextFromPasteEvent(e);
            await setData(pastedData);
            setLoadState({state: "pristine"});
        }, "Failed to paste");
    };

    async function onDrop(f: File[]) {
        await wrapErrorHandling(async (_setProgress) => {
            if (f.length != 1) {
                throw new Error("Cannot open multiple files");
            }
            const text = await readTextFromFile(f[0]);
            await setData({content: text, fileName: f[0].name});
            setLoadState({state: "pristine"});
        }, "Failed to paste");
    }

    const {getRootProps, getInputProps, isDragActive} = useDropzone({
        onDrop,
    });
    const dropClassName = objstr({
        "qg-drop-zone": true,
        "qg-drop-zone-drag-active": isDragActive,
    });

    if (loadState.state == "loading") {
        return (
            <div className="file-selection-page">
                <div className="qg-spinner" />
                {loadState.detail}
            </div>
        );
    } else {
        let renderedError;
        if (loadState.state == "error") {
            renderedError = (
                <Alert variant="danger" className="load-error" onClose={() => setLoadState({state: "pristine"})} dismissible>
                    {loadState.detail}
                </Alert>
            );
        }
        return (
            <div className="file-selection-page">
                <div className="caption">Which query plan do you want to visualize?</div>
                {renderedError}
                <div className="source-alternatives">
                    <div>
                        <div className="source-caption">Copy &amp; Paste</div>
                        <textarea
                            placeholder="Paste your query plan here..."
                            onPaste={onPaste}
                            value=""
                            onChange={e => e.preventDefault()}
                        ></textarea>
                        {!isFirefox ? (
                            <Alert variant="info" className="file-paste-hint">
                                You can also paste files from your Desktop or file manager!
                            </Alert>
                        ) : (
                            <Fragment />
                        )}
                    </div>
                    <div>
                        <div className="source-caption">Local file</div>
                        <div {...getRootProps({className: dropClassName})}>
                            <input {...getInputProps()} />
                            {isDragActive ? (
                                "Drop the file here ..."
                            ) : (
                                <React.Fragment>Drag &apos;n&apos; drop your file here, or click to select a file</React.Fragment>
                            )}
                        </div>
                    </div>
                    <form
                        onSubmit={e => {
                            openURL(url);
                            e.preventDefault();
                        }}
                        className="source-alternative-url"
                    >
                        <div className="source-caption">Remote file</div>
                        <input aria-label="URL" value={url} onChange={e => setUrl(e.target.value)} />
                        <Button type="submit" size="sm">
                            Open URL
                        </Button>
                    </form>
                </div>
            </div>
        );
    }
}
