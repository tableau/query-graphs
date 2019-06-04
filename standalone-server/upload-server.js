var express = require('express');

var http = require('http');
console.log('http.globalAgent.maxSockets = %d', http.globalAgent.maxSockets);

var crypto = require('crypto');
var compression = require('compression');
var bodyParser = require('body-parser');
var multer = require('multer');
var fs = require('fs');
var path = require('path');
var readdirrec = require('recursive-readdir');
var app = express();

var UPLOAD_DIR = "media/uploads/";
var FAVORITES_DIR = "media/favorites/";
var KEEP_FILES = 50;

app.use(compression());
app.use(bodyParser.urlencoded({extended: false, limit: "2mb"}));

app.get("/", function(req, res) {
    res.redirect("upload-form.html");
    res.end();
});

app.use("/", express.static("webroot"));
app.use("/media", express.static("media"));

function generateRandomFilename(extname) {
    // 4 bytes for strings of length 8
    return crypto.randomBytes(4).toString('hex') + extname;
}

var storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function(req, file, cb) {
        cb(null, generateRandomFilename(path.extname(file.originalname)));
    }
});

var upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 20000 // 20MB
    }
});

function deleteOldFiles() {
    fs.readdir(UPLOAD_DIR, function(err, files) {
        if (err) {
            throw (err);
        }
        var fileTimes = [];
        files.forEach(function(file, _index) {
            var stats;

            // Handle race condition
            try {
                stats = fs.statSync(UPLOAD_DIR + file);
            } catch (err) {
                if (err && (err.code === 'ENOENT' || err.code === 'EPERM')) {
                    console.log("Continue from fs.statSync() %s: %s", err.code, UPLOAD_DIR + file);
                    return; // aka forEach continue
                }
                throw (err);
            }

            fileTimes.push({
                filepath: UPLOAD_DIR + file,
                mtime: stats.mtime
            });
        });
        fileTimes.sort(function(a, b) {
            return a.mtime.getTime() - b.mtime.getTime();
        });
        // Only the keep the most recent files, delete the older ones
        for (var i = 0; i < fileTimes.length - KEEP_FILES; i++) {
            console.log("Removing old file: %s", fileTimes[i].filepath);

            // Handle race condition
            try {
                fs.unlinkSync(fileTimes[i].filepath);
            } catch (err) {
                if (err && err.code === 'ENOENT') {
                    console.log("Continue from fs.unlinkSync() ENOENT: %s", fileTimes[i].filepath);
                    continue;
                }
                throw (err);
            }
        }
    });
}

app.post("/file-upload", upload.single("queryfile"), function(req, res, _next) {
    console.log("/file-upload called");
    deleteOldFiles();
    var visualizationUrl = "http://" + req.get("host") + "/query-graphs.html?upload=y&file=" + req.file.filename;
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
    var querytext = req.body.querytext;
    var filename = generateRandomFilename(".txt");
    // Write the query text to a file in the upload directory
    fs.writeFileSync(UPLOAD_DIR + filename, querytext);
    deleteOldFiles();
    // Redirect to the Visualization URL
    res.redirect("http://" + req.get("host") + "/query-graphs.html?upload=y&file=" + filename);
});

function escapeHtml(unsafe) {
    return unsafe.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

app.get("/favorites", function(req, res) {
    readdirrec(FAVORITES_DIR, function(err, files) {
        res.setHeader('Content-Type', 'text/html');
        if (err) {
            console.log(err);
            res.send(err);
            return;
        }
        files.sort();
        var html = "<html><head><title>Favorites</title></head><body><h1>Favorites</h1><ul>";
        var lastPath = [];
        files.forEach(function(name) {
            var relName = path.relative(FAVORITES_DIR, name);
            var relPath = relName.split(path.sep);
            var fileName = relPath.pop();
            var commonLen = 0;
            while (commonLen < Math.min(lastPath.length, relPath.length) && relPath[commonLen] === lastPath[commonLen]) {
                ++commonLen;
            }
            for (var i = lastPath.length; i > commonLen; --i) {
                html += "</ul></li>";
            }
            for (var j = commonLen; j < relPath.length; ++j) {
                html += "<li>" + escapeHtml(relPath[j]) + "<ul>";
            }
            html += "<li><a href='/query-graphs.html?file=" +
                    encodeURIComponent(relName) + "'>" + escapeHtml(fileName) + "</a></li>";
            lastPath = relPath;
        });
        html += "</ul></body></html>";
        res.send(html);
        res.end();
    });
});

var server = app.listen(3000, function() {
    var host = server.address().address;
    var port = server.address().port;
    console.log("Upload server listening at http://%s:%s", host, port);
});
console.log('server.maxConnections = %d', server.maxConnections);
