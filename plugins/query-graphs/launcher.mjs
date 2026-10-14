import {createHash, randomUUID} from "node:crypto";
import {chmod, lstat, mkdir, readFile, realpath, rename, unlink, writeFile} from "node:fs/promises";
import {constants as osConstants, homedir} from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";
import {MAX_RELEASE_ASSET_BYTES as MAX_ASSET_BYTES} from "./src/limits.mjs";

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED_FILES = ["server.mjs", "view.html"];

function digest(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

async function readPin(packageDir) {
    const pin = JSON.parse(await readFile(path.join(packageDir, "release.json"), "utf8"));
    if (
        pin.schemaVersion !== 1 ||
        typeof pin.version !== "string" ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pin.version) ||
        pin.tag !== `plugin-v${pin.version}` ||
        pin.asset !== "query-graphs-plugin.json" ||
        !Number.isSafeInteger(pin.bytes) ||
        pin.bytes < 1 ||
        pin.bytes > MAX_ASSET_BYTES ||
        typeof pin.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(pin.sha256)
    ) {
        throw new Error("The local Query Graphs release pin is invalid.");
    }
    return pin;
}

function parseBundle(bytes, pin) {
    if (bytes.length !== pin.bytes || digest(bytes) !== pin.sha256)
        throw new Error("The Query Graphs release asset failed its pinned size or SHA-256 check.");
    let bundle;
    try {
        bundle = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    } catch (error) {
        throw new Error("The Query Graphs release asset is not valid UTF-8 JSON.", {cause: error});
    }
    const fileNames = Object.keys(bundle?.files ?? {}).sort();
    if (bundle?.schemaVersion !== 1 || bundle.version !== pin.version || fileNames.join(",") !== ALLOWED_FILES.join(",")) {
        throw new Error("The Query Graphs release asset has an unsupported schema, version, or file list.");
    }
    if (ALLOWED_FILES.some((name) => typeof bundle.files[name] !== "string")) {
        throw new Error("The Query Graphs release asset contains a non-text file.");
    }
    return bundle;
}

async function readCachedArtifact(artifactPath, pin) {
    try {
        return parseBundle(await readFile(artifactPath), pin);
    } catch (error) {
        if (error?.code !== "ENOENT") await unlink(artifactPath).catch(() => {});
        return undefined;
    }
}

async function downloadArtifact(pin, fetchImpl) {
    const url = `https://github.com/tableau/query-graphs/releases/download/${encodeURIComponent(pin.tag)}/${encodeURIComponent(pin.asset)}`;
    const response = await fetchImpl(url, {redirect: "follow", signal: AbortSignal.timeout(60_000)});
    if (!response.ok) throw new Error(`GitHub release download failed with HTTP ${response.status}.`);
    if (response.url && new URL(response.url).protocol !== "https:")
        throw new Error("The release download redirected away from HTTPS.");
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ASSET_BYTES)
        throw new Error("The Query Graphs release asset exceeds the download limit.");
    if (!response.body) throw new Error("The GitHub release download returned no body.");

    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        totalBytes += bytes.length;
        if (totalBytes > MAX_ASSET_BYTES || totalBytes > pin.bytes)
            throw new Error("The Query Graphs release download exceeded its pinned size.");
        chunks.push(bytes);
    }
    const asset = Buffer.concat(chunks, totalBytes);
    return {asset, bundle: parseBundle(asset, pin)};
}

async function writeAtomic(filePath, bytes) {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporaryPath, bytes, {flag: "wx", mode: 0o600});
    try {
        await rename(temporaryPath, filePath);
        await chmod(filePath, 0o600);
    } catch (error) {
        await unlink(temporaryPath).catch(() => {});
        throw error;
    }
}

async function ensurePrivateDirectory(directory) {
    await mkdir(directory, {recursive: true, mode: 0o700});
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("The Query Graphs cache path must be a real directory.");
    await chmod(directory, 0o700);
}

async function installVerifiedFiles(cacheDirectory, bundle) {
    for (const name of ALLOWED_FILES) {
        const filePath = path.join(cacheDirectory, name);
        const expected = Buffer.from(bundle.files[name], "utf8");
        let existing;
        try {
            const stats = await lstat(filePath);
            if (stats.isFile() && !stats.isSymbolicLink()) existing = await readFile(filePath);
        } catch (error) {
            if (error?.code !== "ENOENT") throw error;
        }
        if (!existing?.equals(expected)) await writeAtomic(filePath, expected);
        else await chmod(filePath, 0o600);
    }
}

function defaultCacheRoot() {
    const pluginData = process.env.PLUGIN_DATA;
    return pluginData ? path.join(path.resolve(pluginData), "query-graphs") : path.join(homedir(), ".cache", "query-graphs");
}

export async function prepareServer({packageDir = PACKAGE_DIR, cacheRoot = defaultCacheRoot(), fetchImpl = fetch} = {}) {
    const pin = await readPin(packageDir);
    await ensurePrivateDirectory(cacheRoot);
    const cacheDirectory = path.join(cacheRoot, `${pin.version}-${pin.sha256}`);
    await ensurePrivateDirectory(cacheDirectory);
    const artifactPath = path.join(cacheDirectory, pin.asset);
    let bundle = await readCachedArtifact(artifactPath, pin);

    if (bundle === undefined) {
        const downloaded = await downloadArtifact(pin, fetchImpl);
        bundle = downloaded.bundle;
        await writeAtomic(artifactPath, downloaded.asset);
    }

    await installVerifiedFiles(cacheDirectory, bundle);
    return {
        artifactPath,
        serverPath: path.join(cacheDirectory, "server.mjs"),
        viewPath: path.join(cacheDirectory, "view.html"),
        version: pin.version,
    };
}

export function launchServer(serverPath, spawnImpl = spawn) {
    const child = spawnImpl(process.execPath, [serverPath], {stdio: "inherit"});
    const forwardSignal = (signal) => {
        if (!child.killed) child.kill(signal);
    };
    const onInterrupt = () => forwardSignal("SIGINT");
    const onTerminate = () => forwardSignal("SIGTERM");
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);

    return new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            process.off("SIGINT", onInterrupt);
            process.off("SIGTERM", onTerminate);
            if (signal) process.exitCode = 128 + (osConstants.signals[signal] ?? 1);
            else process.exitCode = code ?? 1;
            resolve();
        });
    });
}

export async function startPlugin(options = {}) {
    const files = await prepareServer(options);
    const launch = options.launchImpl ?? launchServer;
    await launch(files.serverPath);
}

const invokedPath = process.argv[1] === undefined ? undefined : await realpath(process.argv[1]).catch(() => undefined);
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) {
    try {
        await startPlugin();
    } catch (error) {
        process.stderr.write(`[query-graphs] ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
