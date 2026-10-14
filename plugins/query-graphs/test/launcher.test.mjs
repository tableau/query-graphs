import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {prepareServer, startPlugin} from "../launcher.mjs";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeAsset(
    version = "0.1.0",
    files = {"server.mjs": "process.exitCode = 0;\n", "view.html": "<!doctype html><p>viewer</p>"},
) {
    return Buffer.from(`${JSON.stringify({schemaVersion: 1, version, files})}\n`);
}

async function makePackage(baseDir, asset, overrides = {}) {
    const packageDir = path.join(baseDir, "package");
    await mkdir(packageDir, {recursive: true});
    const pin = {
        schemaVersion: 1,
        version: "0.1.0",
        tag: "plugin-v0.1.0",
        asset: "query-graphs-plugin.json",
        bytes: asset.length,
        sha256: createHash("sha256").update(asset).digest("hex"),
        ...overrides,
    };
    await writeFile(path.join(packageDir, "release.json"), JSON.stringify(pin));
    return packageDir;
}

function response(asset, {ok = true, status = 200, body = new Response(asset).body} = {}) {
    return {
        ok,
        status,
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

test("cold start downloads the pinned bundle and runs only after verified extraction", async (t) => {
    const temp = await temporary(t);
    const asset = makeAsset();
    const testPackage = await makePackage(temp, asset);
    const cacheRoot = path.join(temp, "cache");
    let requestedUrl;
    let launchPath;
    await startPlugin({
        packageDir: testPackage,
        cacheRoot,
        fetchImpl: async (url) => {
            requestedUrl = url;
            return response(asset);
        },
        launchImpl: async (serverPath) => {
            launchPath = serverPath;
            assert.equal(await readFile(serverPath, "utf8"), "process.exitCode = 0;\n");
        },
    });
    assert.equal(requestedUrl, "https://github.com/tableau/query-graphs/releases/download/plugin-v0.1.0/query-graphs-plugin.json");
    assert.match(launchPath, /0\.1\.0-[a-f0-9]{64}\/server\.mjs$/);
    assert.equal((await stat(launchPath)).mode & 0o777, 0o600);
});

test("hash and size mismatches stop before extracted code can run", async (t) => {
    const temp = await temporary(t);
    const asset = makeAsset();
    const mismatchedHashPackage = await makePackage(temp, asset, {sha256: "0".repeat(64)});
    const cacheRoot = path.join(temp, "cache-hash");
    let ran = false;
    await assert.rejects(
        startPlugin({
            packageDir: mismatchedHashPackage,
            cacheRoot,
            fetchImpl: async () => response(asset),
            launchImpl: async () => {
                ran = true;
            },
        }),
        /pinned size or SHA-256/,
    );
    assert.equal(ran, false);
    const cacheEntries = await readdir(cacheRoot);
    assert.deepEqual(cacheEntries, ["0.1.0-" + "0".repeat(64)]);
    assert.deepEqual(await readdir(path.join(cacheRoot, cacheEntries[0])), []);

    const mismatchSizePackage = await makePackage(temp, asset, {bytes: asset.length + 1});
    await assert.rejects(
        prepareServer({
            packageDir: mismatchSizePackage,
            cacheRoot: path.join(temp, "cache-size"),
            fetchImpl: async () => response(asset),
        }),
        /pinned size or SHA-256/,
    );
});

test("failed and truncated downloads leave no executable cache entries", async (t) => {
    const temp = await temporary(t);
    const asset = makeAsset();
    const testPackage = await makePackage(temp, asset);
    const failedCache = path.join(temp, "failed-cache");
    await assert.rejects(
        prepareServer({
            packageDir: testPackage,
            cacheRoot: failedCache,
            fetchImpl: async () => {
                throw new Error("network down");
            },
        }),
        /network down/,
    );
    assert.deepEqual(await readdir(path.join(failedCache, "0.1.0-" + createHash("sha256").update(asset).digest("hex"))), []);

    const missingCache = path.join(temp, "missing-cache");
    await assert.rejects(
        prepareServer({
            packageDir: testPackage,
            cacheRoot: missingCache,
            fetchImpl: async () => response(asset, {ok: false, status: 404}),
        }),
        /HTTP 404/,
    );
    assert.deepEqual(await readdir(path.join(missingCache, "0.1.0-" + createHash("sha256").update(asset).digest("hex"))), []);

    const partialCache = path.join(temp, "partial-cache");
    const partialBody = new ReadableStream({
        start(controller) {
            controller.enqueue(asset.subarray(0, 8));
            controller.error(new Error("connection dropped"));
        },
    });
    await assert.rejects(
        prepareServer({
            packageDir: testPackage,
            cacheRoot: partialCache,
            fetchImpl: async () => response(asset, {body: partialBody}),
        }),
        /connection dropped/,
    );
    assert.deepEqual(await readdir(path.join(partialCache, "0.1.0-" + createHash("sha256").update(asset).digest("hex"))), []);
});

test("offline cache reuse revalidates extracted files and tolerates concurrent starts", async (t) => {
    const temp = await temporary(t);
    const asset = makeAsset();
    const testPackage = await makePackage(temp, asset);
    const cacheRoot = path.join(temp, "cache");
    let fetchCount = 0;
    const fetchImpl = async () => {
        fetchCount += 1;
        return response(asset);
    };
    const [first, second] = await Promise.all([
        prepareServer({packageDir: testPackage, cacheRoot, fetchImpl}),
        prepareServer({packageDir: testPackage, cacheRoot, fetchImpl}),
    ]);
    assert.equal(first.serverPath, second.serverPath);
    assert.ok(fetchCount === 1 || fetchCount === 2);

    const outsideFile = path.join(temp, "outside.mjs");
    await writeFile(outsideFile, "process.exitCode = 0;\n");
    await chmod(outsideFile, 0o644);
    await unlink(first.serverPath);
    await symlink(outsideFile, first.serverPath);
    const offline = await prepareServer({
        packageDir: testPackage,
        cacheRoot,
        fetchImpl: async () => {
            throw new Error("must use cache");
        },
    });
    assert.equal(await readFile(offline.serverPath, "utf8"), "process.exitCode = 0;\n");
    assert.equal((await lstat(offline.serverPath)).isSymbolicLink(), false);
    assert.equal((await stat(outsideFile)).mode & 0o777, 0o644);

    await writeFile(offline.artifactPath, "corrupt cached asset");
    let ran = false;
    await assert.rejects(
        startPlugin({
            packageDir: testPackage,
            cacheRoot,
            fetchImpl: async () => {
                throw new Error("offline after cache corruption");
            },
            launchImpl: async () => {
                ran = true;
            },
        }),
        /offline after cache corruption/,
    );
    assert.equal(ran, false);
});

test("a hash-valid bundle with unexpected paths or file types is rejected", async (t) => {
    const temp = await temporary(t);
    const asset = makeAsset("0.1.0", {"../outside.mjs": "process.exit(0)", "view.html": "x"});
    const testPackage = await makePackage(temp, asset);
    await assert.rejects(
        prepareServer({packageDir: testPackage, cacheRoot: path.join(temp, "cache"), fetchImpl: async () => response(asset)}),
        /unsupported schema, version, or file list/,
    );
});

test("the checked-in release pin can be read without compiling during plugin install", async () => {
    const pin = JSON.parse(await readFile(path.join(packageDir, "release.json"), "utf8"));
    assert.equal(pin.asset, "query-graphs-plugin.json");
    assert.match(pin.sha256, /^[a-f0-9]{64}$/);
});
