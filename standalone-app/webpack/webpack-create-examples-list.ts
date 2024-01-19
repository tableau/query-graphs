// `prettier` does not yet support `import type`
// eslint-disable-next-line prettier/prettier
import type webpack from 'webpack';
import fs from "fs/promises";
import path from "path";

const examplesDirectory = "examples";

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
    let html = "<html><head><title>Favorites</title></head><body><h1>Favorites</h1><ul>";
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
                    function createLink(absPath: string) {
                        const relPath = path.relative(compiler.context, absPath);
                        const title = path.parse(absPath).base;
                        return `index.html?file=${encodeURIComponent(relPath)}&title=${encodeURIComponent(title)}`;
                    }
                    const code = await generateExamplesList(path.join(compiler.context, examplesDirectory), createLink);
                    compilation.emitAsset("examples.html", new RawSource(code));
                },
            );
        });
    }
}
