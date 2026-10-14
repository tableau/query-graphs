import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {builtinModules} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {MAX_APP_HTML_BYTES, MAX_RELEASE_ASSET_BYTES} from "../src/limits.mjs";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(PACKAGE_DIR, "dist");

export async function buildPlugin(versionOverride) {
    const packageJson = JSON.parse(await readFile(path.join(PACKAGE_DIR, "package.json"), "utf8"));
    const version = versionOverride ?? packageJson.version;
    await rm(DIST_DIR, {recursive: true, force: true});
    await mkdir(DIST_DIR, {recursive: true});

    const serverBuild = await build({
        absWorkingDir: PACKAGE_DIR,
        entryPoints: ["src/server.mjs"],
        outfile: path.join(DIST_DIR, "server.mjs"),
        bundle: true,
        packages: "bundle",
        platform: "node",
        target: "node24",
        format: "esm",
        minify: true,
        legalComments: "none",
        sourcemap: false,
        define: {__QUERY_GRAPHS_VERSION__: JSON.stringify(version)},
        write: true,
        metafile: true,
        logLevel: "info",
    });
    const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
    const serverExternalImports = Object.values(serverBuild.metafile.outputs)
        .flatMap((output) => output.imports)
        .filter((entry) => entry.external && !nodeBuiltins.has(entry.path));
    if (serverExternalImports.length > 0) {
        throw new Error(
            `The server bundle leaves external dependencies: ${serverExternalImports.map(({path: importPath}) => importPath).join(", ")}`,
        );
    }

    const browserBuild = await build({
        absWorkingDir: PACKAGE_DIR,
        entryPoints: ["src/view.tsx"],
        outfile: path.join(DIST_DIR, "view.js"),
        bundle: true,
        packages: "bundle",
        platform: "browser",
        target: "es2022",
        format: "iife",
        jsx: "automatic",
        minify: true,
        legalComments: "none",
        sourcemap: false,
        loader: {".css": "css"},
        define: {__QUERY_GRAPHS_VERSION__: JSON.stringify(version), "process.env.NODE_ENV": '"production"'},
        write: false,
        metafile: true,
        logLevel: "info",
    });
    const browserExternalImports = Object.values(browserBuild.metafile.outputs)
        .flatMap((output) => output.imports)
        .filter((entry) => entry.external);
    if (browserExternalImports.length > 0 || browserBuild.outputFiles.length !== 2) {
        throw new Error("The browser viewer must bundle every dependency and runtime chunk inline.");
    }
    const script = browserBuild.outputFiles.find(({path: outputPath}) => outputPath.endsWith("view.js"))?.text;
    const style = browserBuild.outputFiles.find(({path: outputPath}) => outputPath.endsWith("view.css"))?.text;
    if (script === undefined || style === undefined) throw new Error("The browser build did not emit both JavaScript and CSS.");
    const safeScript = script.replace(/<\/script/gi, "<\\/script");
    const safeStyle = style.replace(/<\/style/gi, "<\\/style");
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Query Graphs</title>
<style>${safeStyle}</style>
</head>
<body>
<div id="plugin-shell" class="qg-theme qg-plugin-shell" data-theme="light">
<button id="expand" type="button" hidden>Expand viewer</button>
<div id="display-error" hidden role="status"></div>
<div id="root"></div>
</div>
<script>${safeScript}</script>
</body>
</html>
`;
    const htmlBytes = Buffer.byteLength(html, "utf8");
    if (htmlBytes > MAX_APP_HTML_BYTES) throw new Error(`The self-contained app HTML exceeds ${MAX_APP_HTML_BYTES} bytes.`);
    await writeFile(path.join(DIST_DIR, "view.html"), html, "utf8");

    const files = {
        "server.mjs": await readFile(path.join(DIST_DIR, "server.mjs"), "utf8"),
        "view.html": html,
    };
    const artifact = `${JSON.stringify({schemaVersion: 1, version, files})}\n`;
    const artifactBytes = Buffer.byteLength(artifact, "utf8");
    if (artifactBytes > MAX_RELEASE_ASSET_BYTES)
        throw new Error(`The release asset exceeds the launcher's ${MAX_RELEASE_ASSET_BYTES}-byte download limit.`);
    const artifactPath = path.join(DIST_DIR, "query-graphs-plugin.json");
    await writeFile(artifactPath, artifact, "utf8");
    return {artifactPath, artifact: Buffer.from(artifact), version};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPlugin();
