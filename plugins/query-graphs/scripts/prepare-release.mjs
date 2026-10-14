import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildPlugin} from "./build.mjs";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(PACKAGE_DIR, "package.json");
const pluginPath = path.join(PACKAGE_DIR, ".codex-plugin", "plugin.json");
const pinPath = path.join(PACKAGE_DIR, "release.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const requestedVersion = process.argv.slice(2).find((argument) => argument !== "--") ?? packageJson.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requestedVersion)) throw new Error(`Invalid release version: ${requestedVersion}`);

const {artifact, version} = await buildPlugin(requestedVersion);
const pluginManifest = JSON.parse(await readFile(pluginPath, "utf8"));
packageJson.version = version;
pluginManifest.version = version;
const pin = {
    schemaVersion: 1,
    version,
    tag: `plugin-v${version}`,
    asset: "query-graphs-plugin.json",
    bytes: artifact.length,
    sha256: createHash("sha256").update(artifact).digest("hex"),
};
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile(pluginPath, `${JSON.stringify(pluginManifest, null, 2)}\n`);
await writeFile(pinPath, `${JSON.stringify(pin, null, 2)}\n`);
process.stdout.write(`Prepared ${pin.tag}: ${pin.bytes} bytes, sha256 ${pin.sha256}\n`);
