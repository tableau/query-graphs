import type webpack from "webpack";
import {execFileSync} from "node:child_process";
import fs from "fs/promises";
import path from "path";

const examplesDirectory = "examples";

interface ExamplesIndex {
    engines: Record<string, {queries: Record<string, Record<string, {plan: string; sql: string}>>}>;
}

function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

type CreateLink = (path: string) => string;

async function generateSubDirList(dirPath: string, createLink: CreateLink): Promise<string> {
    let html = "";
    const folderContents = await fs.readdir(dirPath, {withFileTypes: true});
    for (const entry of folderContents) {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            const subHtml = await generateSubDirList(entryPath, createLink);
            if (subHtml.length) {
                html += `<li>${escapeHtml(entry.name)}</li><ul>${subHtml}</ul>`;
            }
        } else {
            const link = createLink(entryPath);
            if (link) {
                html += `<li><a href="${escapeHtml(link)}">${escapeHtml(entry.name)}</a></li>`;
            }
        }
    }
    return html;
}

async function generateExamplesList(dirPath: string, createLink: CreateLink) {
    let html = "<html><head><title>Example Query Plans</title></head><body><h1>Example Query Plans</h1><ul>";
    html += await generateSubDirList(dirPath, createLink);
    html += "</ul></body></html>";
    return html;
}

// Plugin used to create the file list
export class CreateExamplesListPlugin {
    // Define `apply` as its prototype method which is supplied with compiler as its argument
    apply(compiler: webpack.Compiler) {
        const pluginName = this.constructor.name;
        compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
            compilation.hooks.processAssets.tapPromise(
                {
                    name: pluginName,
                    stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                },
                async (_assets) => {
                    const {RawSource} = compiler.webpack.sources;
                    const examplesPath = path.join(compiler.context, examplesDirectory);
                    const index = JSON.parse(await fs.readFile(path.join(examplesPath, "index.json"), "utf8")) as ExamplesIndex;
                    const indexedExamples = Object.values(index.engines).flatMap((engine) =>
                        Object.values(engine.queries).flatMap((modes) => Object.values(modes)),
                    );
                    const planDumperPath = path.join(compiler.context, "../plan-dumper/dump-plans.py");
                    const queryFormattingPath = path.join(compiler.context, "../plan-dumper/query_formatting.py");
                    const queriesPath = path.join(compiler.context, "../plan-dumper/queries");
                    compilation.fileDependencies.add(planDumperPath);
                    compilation.fileDependencies.add(queryFormattingPath);
                    compilation.contextDependencies.add(queriesPath);
                    const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
                    const generatedSql = JSON.parse(
                        execFileSync(python, ["-B", planDumperPath, "--print-example-sql"], {
                            encoding: "utf8",
                            maxBuffer: 10 * 1024 * 1024,
                        }),
                    ) as Record<string, string>;
                    const indexedSqlFiles = new Set(indexedExamples.map((files) => `examples/${files.sql}`));
                    for (const [sqlPath, sql] of Object.entries(generatedSql)) {
                        const sqlFile = `examples/${sqlPath}`;
                        if (!indexedSqlFiles.has(sqlFile)) {
                            throw new Error(`plan-dumper returned unknown SQL file ${sqlPath}`);
                        }
                        compilation.emitAsset(sqlFile, new RawSource(sql));
                    }
                    if (Object.keys(generatedSql).length !== indexedSqlFiles.size) {
                        throw new Error(
                            `plan-dumper returned ${Object.keys(generatedSql).length} of ${indexedSqlFiles.size} SQL files`,
                        );
                    }
                    function createLink(absPath: string) {
                        const relPath = path.relative(compiler.context, absPath).split(path.sep).join("/");
                        const planPath = path.relative(examplesPath, absPath).split(path.sep).join("/");
                        const title = path.parse(absPath).base;
                        const params = new URLSearchParams({file: relPath, title});
                        const sqlPath = indexedExamples.find((files) => files.plan === planPath)?.sql;
                        if (sqlPath !== undefined) params.set("sql-file", `examples/${sqlPath}`);
                        return `index.html?${params.toString()}`;
                    }
                    const code = await generateExamplesList(examplesPath, createLink);
                    compilation.emitAsset("examples.html", new RawSource(code));
                },
            );
        });
    }
}
