import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [packageJson, pluginManifest, pin, artifact] = await Promise.all([
    readFile(path.join(PACKAGE_DIR, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(PACKAGE_DIR, ".codex-plugin", "plugin.json"), "utf8").then(JSON.parse),
    readFile(path.join(PACKAGE_DIR, "release.json"), "utf8").then(JSON.parse),
    readFile(path.join(PACKAGE_DIR, "dist", "query-graphs-plugin.json")),
]);
const bundle = JSON.parse(artifact.toString("utf8"));
const actualHash = createHash("sha256").update(artifact).digest("hex");
const expectedTag = `plugin-v${packageJson.version}`;
const releaseTag = process.argv.slice(2).find((argument) => argument !== "--");
const fileNames = Object.keys(bundle.files ?? {}).sort();
if (packageJson.version !== pluginManifest.version || packageJson.version !== pin.version || bundle.version !== pin.version) {
    throw new Error("Package, plugin manifest, release pin, and rebuilt bundle versions do not match.");
}
if (pin.schemaVersion !== 1 || pin.tag !== expectedTag || pin.asset !== "query-graphs-plugin.json") {
    throw new Error("The release pin has an unsupported schema, tag, or asset name.");
}
if (releaseTag !== undefined && releaseTag !== pin.tag)
    throw new Error(`Tag ${releaseTag} does not match pinned release tag ${pin.tag}.`);
if (bundle.schemaVersion !== 1 || fileNames.join(",") !== "server.mjs,view.html") {
    throw new Error("The rebuilt release bundle has an unsupported schema or file list.");
}
if (artifact.length !== pin.bytes || actualHash !== pin.sha256) {
    throw new Error(
        `Rebuilt asset does not match release.json (bytes ${artifact.length}/${pin.bytes}, sha256 ${actualHash}/${pin.sha256}).`,
    );
}
process.stdout.write(`Verified ${pin.tag}: ${artifact.length} bytes, sha256 ${actualHash}\n`);
