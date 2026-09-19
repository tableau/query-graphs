export interface FoldRange {
    from: number;
    to: number;
}

function addFold(folds: Map<number, FoldRange>, lineStart: number, fold: FoldRange) {
    const existing = folds.get(lineStart);
    if (existing === undefined || fold.to - fold.from > existing.to - existing.from) folds.set(lineStart, fold);
}

interface LineComment {
    lineStart: number;
    lineEnd: number;
    nextLineStart?: number;
}

function addLineCommentFolds(lineComments: readonly LineComment[], folds: Map<number, FoldRange>) {
    for (let runStart = 0; runStart < lineComments.length;) {
        let runEnd = runStart + 1;
        while (runEnd < lineComments.length && lineComments[runEnd].lineStart === lineComments[runEnd - 1].nextLineStart) {
            runEnd++;
        }
        if (runEnd - runStart >= 3) {
            const first = lineComments[runStart];
            const last = lineComments[runEnd - 1];
            addFold(folds, first.lineStart, {from: first.lineEnd, to: last.lineEnd});
        }
        runStart = runEnd;
    }
}

// Find useful structural folds without exposing the SQL parser's whole-statement folds.
export function findSqlFolds(text: string): ReadonlyMap<number, FoldRange> {
    const openParentheses: {position: number; lineStart: number}[] = [];
    const lineComments: LineComment[] = [];
    const folds = new Map<number, FoldRange>();
    let quote: "'" | '"' | "`" | "]" | undefined;
    let lineComment: {foldLineStart?: number} | undefined;
    let blockComment: {position: number; lineStart: number} | undefined;
    let lineStart = 0;

    for (let position = 0; position < text.length; position++) {
        const character = text[position];
        const nextCharacter = text[position + 1];
        if (character === "\n") lineStart = position + 1;

        if (lineComment !== undefined) {
            if (character === "\n") {
                if (lineComment.foldLineStart !== undefined) {
                    lineComments.push({
                        lineStart: lineComment.foldLineStart,
                        lineEnd: text[position - 1] === "\r" ? position - 1 : position,
                        nextLineStart: position + 1,
                    });
                }
                lineComment = undefined;
            }
            continue;
        }
        if (blockComment !== undefined) {
            if (character === "*" && nextCharacter === "/") {
                if (lineStart > blockComment.lineStart) {
                    addFold(folds, blockComment.lineStart, {from: blockComment.position + 2, to: position});
                }
                blockComment = undefined;
                position++;
            }
            continue;
        }
        if (quote !== undefined) {
            if (character === quote) {
                if (nextCharacter === quote) position++;
                else quote = undefined;
            } else if (character === "\\") {
                position++;
            }
            continue;
        }

        if (character === "-" && nextCharacter === "-") {
            lineComment = {foldLineStart: text.slice(lineStart, position).trim() === "" ? lineStart : undefined};
            position++;
        } else if (character === "/" && nextCharacter === "*") {
            blockComment = {position, lineStart};
            position++;
        } else if (character === "'" || character === '"' || character === "`") {
            quote = character;
        } else if (character === "[") {
            quote = "]";
        } else if (character === "(") {
            openParentheses.push({position, lineStart});
        } else if (character === ")") {
            const open = openParentheses.pop();
            if (open !== undefined && lineStart > open.lineStart) {
                addFold(folds, open.lineStart, {from: open.position + 1, to: position});
            }
        }
    }

    if (lineComment?.foldLineStart !== undefined) {
        lineComments.push({lineStart: lineComment.foldLineStart, lineEnd: text.length});
    }
    addLineCommentFolds(lineComments, folds);
    return folds;
}
