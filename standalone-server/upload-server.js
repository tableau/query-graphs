const express = require("express");

const http = require("http");
console.log("http.globalAgent.maxSockets = %d", http.globalAgent.maxSockets);

const crypto = require("crypto");
const compression = require("compression");
const bodyParser = require("body-parser");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const readdirrec = require("recursive-readdir");
const app = express();

const WEBROOT_DIR = "webroot/";
const UPLOAD_DIR = path.join(WEBROOT_DIR, "uploads");
const FAVORITES_DIR = path.join(WEBROOT_DIR, "favorites");
const KEEP_FILES = 50;

fs.mkdirSync(UPLOAD_DIR, {recursive: true});
fs.mkdirSync(FAVORITES_DIR, {recursive: true});

app.use(compression());
app.use(bodyParser.urlencoded({extended: false, limit: "2mb"}));

app.get("/", function(req, res) {
    res.redirect("upload-form.html");
    res.end();
});

app.use("/", express.static(WEBROOT_DIR));

function generateRandomFilename(extname) {
    // 4 bytes for strings of length 8
    return crypto.randomBytes(4).toString("hex") + extname;
}

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function(req, file, cb) {
        cb(null, generateRandomFilename(path.extname(file.originalname)));
    },
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 20000, // 20MB
    },
});

function deleteOldFiles() {
    fs.readdir(UPLOAD_DIR, function(err, files) {
        if (err) {
            throw err;
        }
        const fileTimes = [];
        files.forEach(function(file, _index) {
            let stats;

            // Handle race condition
            try {
                stats = fs.statSync(path.join(UPLOAD_DIR, file));
            } catch (err) {
                if (err && (err.code === "ENOENT" || err.code === "EPERM")) {
                    console.log("Continue from fs.statSync() %s: %s", err.code, UPLOAD_DIR + file);
                    return; // aka forEach continue
                }
                throw err;
            }

            fileTimes.push({
                filepath: path.join(UPLOAD_DIR, file),
                mtime: stats.mtime,
            });
        });
        fileTimes.sort(function(a, b) {
            return a.mtime.getTime() - b.mtime.getTime();
        });
        // Only the keep the most recent files, delete the older ones
        for (let i = 0; i < fileTimes.length - KEEP_FILES; i++) {
            console.log("Removing old file: %s", fileTimes[i].filepath);

            // Handle race condition
            try {
                fs.unlinkSync(fileTimes[i].filepath);
            } catch (err) {
                if (err && err.code === "ENOENT") {
                    console.log("Continue from fs.unlinkSync() ENOENT: %s", fileTimes[i].filepath);
                    continue;
                }
                throw err;
            }
        }
    });
}

function getVisualizationURL(req, filePath) {
    const relpath = path.relative(WEBROOT_DIR, filePath);
    const properties = encodeURIComponent(JSON.stringify({file: relpath}));
    return "http://" + req.get("host") + "/query-graphs.html?file=" + encodeURIComponent(relpath) + "&properties=" + properties;
}

app.post("/file-upload", upload.single("queryfile"), function(req, res, _next) {
    console.log("/file-upload called");
    deleteOldFiles();
    const visualizationUrl = getVisualizationURL(req, path.join(UPLOAD_DIR, req.file.filename));
    console.log(req.body);
    if (req.body && req.body.redirect && req.body.redirect === "yes") {
        // Redirect to the Visualization URL
        res.redirect(visualizationUrl);
    } else {
        // Send the Visualization URL in the response
        res.send(visualizationUrl);
    }
});

app.post("/text-upload", function(req, res) {
    console.log("/text-upload called");
    const querytext = req.body.querytext;
    const filename = path.join(UPLOAD_DIR, generateRandomFilename(".txt"));
    // Write the query text to a file in the upload directory
    fs.writeFileSync(filename, querytext);
    deleteOldFiles();
    // Redirect to the Visualization URL
    res.redirect(getVisualizationURL(req, filename));
});

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

app.get("/favorites", function(req, res) {
    readdirrec(FAVORITES_DIR, function(err, files) {
        res.setHeader("Content-Type", "text/html");
        if (err) {
            console.log(err);
            res.send(err);
            return;
        }
        files.sort();
        let html = "<html><head><title>Favorites</title></head><body><h1>Favorites</h1><ul>";
        let lastPath = [];
        files.forEach(function(name) {
            const relName = path.relative(FAVORITES_DIR, name);
            const relPath = relName.split(path.sep);
            const fileName = relPath.pop();
            let commonLen = 0;
            while (commonLen < Math.min(lastPath.length, relPath.length) && relPath[commonLen] === lastPath[commonLen]) {
                ++commonLen;
            }
            for (let i = lastPath.length; i > commonLen; --i) {
                html += "</ul></li>";
            }
            for (let j = commonLen; j < relPath.length; ++j) {
                html += "<li>" + escapeHtml(relPath[j]) + "<ul>";
            }
            html += "<li><a href='" + escapeHtml(getVisualizationURL(req, name)) + "'>" + escapeHtml(fileName) + "</a></li>";
            lastPath = relPath;
        });
        html += "</ul></body></html>";
        res.send(html);
        res.end();
    });
});

const server = app.listen(3000, function() {
    const host = server.address().address;
    const port = server.address().port;
    console.log("Upload server listening at http://%s:%s", host, port);
});
console.log("server.maxConnections = %d", server.maxConnections);
