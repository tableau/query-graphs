import {StandardSQL} from "@codemirror/lang-sql";
import {foldNodeProp, foldService} from "@codemirror/language";
import type {EditorState} from "@codemirror/state";
import {CodeMirrorDocument} from "./CodeMirrorDocument";
import type {DocumentViewerProps} from "./CodeMirrorDocument";
import {findSqlFolds, type FoldRange} from "./SqlFolding";

const sqlFolds = new WeakMap<object, ReadonlyMap<number, FoldRange>>();

function getSqlFolds(state: EditorState): ReadonlyMap<number, FoldRange> {
    const cached = sqlFolds.get(state.doc);
    if (cached !== undefined) return cached;
    const folds = findSqlFolds(state.doc.toString());
    sqlFolds.set(state.doc, folds);
    return folds;
}

// The SQL parser otherwise advertises whole statements and block comments as foldable ranges.
const noSyntaxFolding = foldNodeProp.add(() => () => null);
const sqlDialect = StandardSQL.configureLanguage({props: [noSyntaxFolding]});
const sqlLanguage = sqlDialect.language.extension;
const customSqlFolding = foldService.of((state, lineStart) => getSqlFolds(state).get(lineStart) ?? null);
const sqlExtensions = [sqlLanguage, customSqlFolding];

export function SqlDocument(props: DocumentViewerProps) {
    return <CodeMirrorDocument {...props} languageExtension={sqlExtensions} />;
}
