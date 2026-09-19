import {sql} from "@codemirror/lang-sql";
import type {TextDocument} from "@tableau/query-graphs/lib/tree-description";
import {CodeDocument} from "./CodeDocument";

const sqlLanguage = sql();

export function SqlDocument({document}: {document: TextDocument}) {
    return <CodeDocument document={document} languageExtension={sqlLanguage} />;
}
