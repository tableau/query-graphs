import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {prepareServer, startPlugin} from "../launcher.mjs";

function makeAsset(files = {"server.mjs": "process.exitCode = 0;\n", "view.html": "<!doctype html><p>viewer</p>"}) {
    return Buffer.from(`${JSON.stringify({schemaVersion: 1, version: "0.1.0", files})}\n`);
}

async function makePackage(baseDir, asset, sha256 = createHash("sha256").update(asset).digest("hex")) {
    const packageDir = path.join(baseDir, "package");
    await mkdir(packageDir, {recursive: true});
    await writeFile(
        path.join(packageDir, "release.json"),
        JSON.stringify({
            schemaVersion: 1,
            version: "0.1.0",
            tag: "plugin-v0.1.0",
            asset: "query-graphs-plugin.json",
            bytes: asset.length,
            sha256,
        }),
    );
    return packageDir;
}

function response(asset, body = new Response(asset).body) {
    return {
        ok: true,
        status: 200,
        url: "https://release-assets.githubusercontent.com/asset",
        headers: new Headers({"content-length": String(asset.length)}),
        body,
    };
}

async function temporary(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "query-graphs-launcher-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    return directory;
}

test("cold start verifies the pinned bundle before launching the cached server", async (t) => {
    const temp = await temporary(t);
    const asset = makeAsset();
    const packageDir = await makePackage(temp, asset);
    let requestedUrl;
    let launchedText;
    await startPlugin({
        packageDir,
        cacheRoot: path.join(temp, "cache"),
        fetchImpl: async (url) => {
            requestedUrl = url;
            return response(asset);
        },
        launchImpl: async (serverPath) => {
            launchedText = await readFile(serverPath, "utf8");
            assert.equal((await stat(serverPath)).mode & 0o777, 0o600);
        },
    });
    assert.equal(requestedUrl, "https://github.com/tableau/query-graphs/releases/download/plugin-v0.1.0/query-graphs-plugin.json");
    assert.equal(launchedText, "process.exitCode = 0;\n");
});

test("size or hash mismatches stop before cached code can run", async (t) => {
    const temp = await temporary(t);
    const asset = makeAsset();
    const hashPackage = await makePackage(path.join(temp, "hash"), asset, "0".repeat(64));
    let ran = false;
    await assert.rejects(
        startPlugin({
            packageDir: hashPackage,
            cacheRoot: path.join(temp, "hash-cache"),
            fetchImpl: async () => response(asset),
            launchImpl: async () => {
                ran = true;
            },
        }),
        /pinned size or SHA-256/,
    );
    assert.equal(ran, false);

    const sizePackage = await makePackage(path.join(temp, "size"), asset);
    const pinPath = path.join(sizePackage, "release.json");
    const pin = JSON.parse(await readFile(pinPath, "utf8"));
    pin.bytes += 1;
    await writeFile(pinPath, JSON.stringify(pin));
    await assert.rejects(
        prepareServer({
            packageDir: sizePackage,
            cacheRoot: path.join(temp, "size-cache"),
            fetchImpl: async () => response(asset),
        }),
        /pinned size or SHA-256/,
    );
});

test("an interrupted download leaves no runnable cache and can be retried", async (t) => {
    const temp = await temporary(t);
    const asset = makeAsset();
    const packageDir = await makePackage(temp, asset);
    const cacheRoot = path.join(temp, "cache");
    let interrupted = true;
    const fetchImpl = async () => {
        if (!interrupted) return response(asset);
        interrupted = false;
        const partialBody = new ReadableStream({
            start(controller) {
                controller.enqueue(asset.subarray(0, 8));
                controller.error(new Error("connection dropped"));
            },
        });
        return response(asset, partialBody);
    };
    await assert.rejects(prepareServer({packageDir, cacheRoot, fetchImpl}), /connection dropped/);

    let launchedText;
    await startPlugin({
        packageDir,
        cacheRoot,
        fetchImpl,
        launchImpl: async (serverPath) => {
            launchedText = await readFile(serverPath, "utf8");
        },
    });
    assert.equal(launchedText, "process.exitCode = 0;\n");
});

test("offline cache reuse repairs a replaced server and blocks a corrupted artifact", async (t) => {
    const temp = await temporary(t);
    const asset = makeAsset();
    const packageDir = await makePackage(temp, asset);
    const cacheRoot = path.join(temp, "cache");
    const [first, second] = await Promise.all([
        prepareServer({packageDir, cacheRoot, fetchImpl: async () => response(asset)}),
        prepareServer({packageDir, cacheRoot, fetchImpl: async () => response(asset)}),
    ]);
    assert.equal(await readFile(first.serverPath, "utf8"), "process.exitCode = 0;\n");
    assert.equal(await readFile(second.serverPath, "utf8"), "process.exitCode = 0;\n");

    const outsideFile = path.join(temp, "outside.mjs");
    await writeFile(outsideFile, "process.exitCode = 0;\n");
    await chmod(outsideFile, 0o644);
    await unlink(first.serverPath);
    await symlink(outsideFile, first.serverPath);
    const offline = await prepareServer({
        packageDir,
        cacheRoot,
        fetchImpl: async () => {
            throw new Error("must use cache");
        },
    });
    assert.equal(await readFile(offline.serverPath, "utf8"), "process.exitCode = 0;\n");
    assert.equal((await lstat(offline.serverPath)).isSymbolicLink(), false);
    assert.equal((await stat(outsideFile)).mode & 0o777, 0o644);

    await writeFile(offline.artifactPath, "corrupt cached asset");
    await assert.rejects(
        startPlugin({
            packageDir,
            cacheRoot,
            fetchImpl: async () => {
                throw new Error("offline after cache corruption");
            },
            launchImpl: async () => {
                throw new Error("corrupt cached code must not run");
            },
        }),
        /offline after cache corruption/,
    );
});

test("bundles with unexpected file paths are rejected", async (t) => {
    const temp = await temporary(t);
    const asset = makeAsset({"../outside.mjs": "process.exit(0)", "view.html": "x"});
    const packageDir = await makePackage(temp, asset);
    await assert.rejects(
        prepareServer({packageDir, cacheRoot: path.join(temp, "cache"), fetchImpl: async () => response(asset)}),
        /unsupported schema, version, or file list/,
    );
});
