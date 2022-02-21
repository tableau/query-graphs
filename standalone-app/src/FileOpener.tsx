import React, {useMemo, useState} from "react";
import {useDropzone} from "react-dropzone";
import Alert from "react-bootstrap/Alert";
import objstr from "./objstr";

import "./FileOpener.css";
import {assert} from "./assert";

export interface FileOpenerData {
    // This might be a Blob URL.
    // Make sure to call `URL.revokeBlobURL` if you no longer need it.
    url: URL;
    fileName?: string;
}

const isFirefox = /Firefox\/([0-9]+)\./.test(navigator.userAgent);

async function getTextFromPasteEvent(e: React.ClipboardEvent): Promise<FileOpenerData> {
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
        return {url: new URL(URL.createObjectURL(f)), fileName: f.name};
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
            // Recognize copy-pasted URLs and open them
            try {
                const url = new URL(text);
                return {url};
            } catch (_e) {
                /*don't care about failures*/
            }
            // Open the pasted text
            const textBlob = new Blob([text]);
            return {url: new URL(URL.createObjectURL(textBlob))};
        } else {
            const typesString = items.map(e => e.type).join(", ");
            throw new Error(`None of the following types are supported: ${typesString}`);
        }
    }
}

interface RawLoadState {
    state: "pristine" | "loading" | "error";
    detail?: string;
}

interface LoadStateController {
    loadState: RawLoadState;
    clearLoadState: () => void;
    setProgress: (msg: string) => void;
    setError: (msg: string) => void;
    tryAndDisplayErrors: (doIt: () => Promise<void>) => Promise<void>;
}

export function useLoadStateController(): LoadStateController {
    const [loadState, setLoadState] = useState<RawLoadState>({state: "pristine"});
    return useMemo(() => {
        const setProgress = (msg: string) => setLoadState({state: "loading", detail: msg});
        const setError = (msg: string) => setLoadState({state: "error", detail: msg});
        const tryAndDisplayErrors = async (doIt: () => Promise<void>) => {
            try {
                await doIt();
            } catch (e) {
                if (loadState.state == "loading") {
                    // Show the error only after some additional time.
                    // Thereby, we make sure that the spinner is visible at least for a short moment and
                    // we don't get an unpleasant "flash" in case the download fails immediately.
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
                let msg;
                if (e instanceof Error) {
                    msg = e.message;
                } else {
                    console.log(e);
                    msg = "Unknown error";
                }
                setError(msg);
            }
        };
        return {
            loadState,
            clearLoadState: () => setLoadState({state: "pristine"}),
            setProgress,
            setError,
            tryAndDisplayErrors,
        };
    }, [loadState, setLoadState]);
}

interface FileOpenerProps {
    /// Callback called with the selected data.
    /// Might throw an `Exception` if it can't open the received file.
    setData: (data: FileOpenerData) => Promise<void>;
    /// Controller for displaying progress/completion
    loadStateController: LoadStateController;
}

export function FileOpener({setData, loadStateController}: FileOpenerProps) {
    const {loadState, clearLoadState, tryAndDisplayErrors} = loadStateController;

    const onPaste = async (e: React.ClipboardEvent) => {
        e.preventDefault();
        await tryAndDisplayErrors(async () => {
            await setData(await getTextFromPasteEvent(e));
            clearLoadState();
        });
    };

    async function onDrop(files: File[]) {
        await tryAndDisplayErrors(async () => {
            if (files.length != 1) {
                throw new Error("Cannot open multiple files");
            }
            const f = files[0];
            await setData({url: new URL(URL.createObjectURL(f)), fileName: f.name});
            clearLoadState();
        });
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
                <Alert variant="danger" className="load-error" onClose={() => clearLoadState()} dismissible>
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
                        <Alert variant="info" className="paste-hint">
                            {!isFirefox
                                ? "You can also paste `http(s)://` URLs or files from your Desktop or file manager!"
                                : "You can also paste `http(s)://` URLs!"}
                        </Alert>
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
                </div>
            </div>
        );
    }
}
