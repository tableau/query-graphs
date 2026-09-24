import {json} from "@codemirror/lang-json";
import {CodeMirrorDocument} from "./CodeMirrorDocument";
import type {DocumentViewerProps} from "./CodeMirrorDocument";

const jsonLanguage = json();

export function JsonDocument(props: DocumentViewerProps) {
    return <CodeMirrorDocument {...props} languageExtension={jsonLanguage} />;
}
