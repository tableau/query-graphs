const express = require("express");
const crypto = require("crypto");
const compression = require("compression");
const cors = require("cors");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

const app = express();
app.use(compression());

const GUI_URL = "https://tableau.github.io/query-graphs/index.html";
const UPLOAD_DIR = "uploads/";
const KEEP_FILES = 50;
const UPLOADS_URL_PATH = "/uploads";
fsSync.mkdirSync(UPLOAD_DIR, {recursive: true});

const uploadLogger = require("debug")("upload-server:uploads");
async function deleteOldFiles() {
    const files = await fs.readdir(UPLOAD_DIR);
    const fileTimes = [];
    for (const file in files) {
        try {
            const stats = await fs.stat(path.join(UPLOAD_DIR, file));
            fileTimes.push({
                filepath: path.join(UPLOAD_DIR, file),
                mtime: stats.mtime,
            });
        } catch (err) {
            // Handle race condition
            if (err && (err.code === "ENOENT" || err.code === "EPERM")) {
                uploadLogger("Continue = require(fs.statSync() %s: %s", err.code, UPLOAD_DIR + file);
            } else {
                throw err;
            }
        }
    }
    fileTimes.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
    // Only the keep the most recent files, delete the older ones
    for (let i = 0; i < fileTimes.length - KEEP_FILES; i++) {
        try {
            uploadLogger("Removing old file: %s", fileTimes[i].filepath);
            fs.unlinkSync(fileTimes[i].filepath);
        } catch (err) {
            // Handle race condition
            if (err && err.code === "ENOENT") {
                uploadLogger("Continue = require(fs.unlinkSync() ENOENT: %s", fileTimes[i].filepath);
                continue;
            } else {
                throw err;
            }
        }
    }
}

app.use(UPLOADS_URL_PATH, cors(), express.static(UPLOAD_DIR));
app.options(UPLOADS_URL_PATH, cors());
app.put(UPLOADS_URL_PATH, cors(), express.raw({limit: "2mb", type: "*/*"}), async (req, res) => {
    console.log(req.get("Content-Type"));
    if (!(req.body instanceof Buffer)) {
        uploadLogger("upload without payload called");
        res.sendStatus(400);
        return;
    }
    uploadLogger("upload called");
    await deleteOldFiles();
    const filename = crypto.randomBytes(4).toString("hex") + ".txt";
    const uploadPath = path.join(UPLOAD_DIR, filename);
    uploadLogger(`writing uploaded file to "${uploadPath}"`);
    await fs.writeFile(uploadPath, req.body);
    const ownUrl = req.protocol + "://" + req.get("host");
    const uploadUrl = ownUrl + path.join(UPLOADS_URL_PATH, filename);
    uploadLogger(`sending uploaded URL "${uploadUrl}"`);
    res.send(uploadUrl);
});

const guiLogger = require("debug")("upload-server:gui");
function forwardToGUI(req, res) {
    const ownUrl = req.protocol + "://" + req.get("host") + UPLOADS_URL_PATH;
    const forwardURL = `${GUI_URL}?uploadServer=${encodeURIComponent(ownUrl)}`;
    res.redirect(forwardURL);
    res.end();
    guiLogger(`forwarded to ${forwardURL}`);
}
app.get("/", forwardToGUI);
// Common names used previously by the standalone server.
// Forward them in case somebody bookmarked the old UI.
app.get("/upload-form.html", forwardToGUI);
app.get("/query-graphs.html", forwardToGUI);

const server = app.listen(3000, function() {
    const host = server.address().address;
    const port = server.address().port;
    console.log("Upload server listening at http://%s:%s", host, port);
});
console.log("server.maxConnections = %d", server.maxConnections);
