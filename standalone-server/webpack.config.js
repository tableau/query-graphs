const path = require("path");

module.exports = {
    entry: {
        "query-graphs": "./app.ts",
        legend: "./legend.ts",
    },
    output: {
        path: path.resolve(__dirname, "webroot"),
        filename: "[name].min.js",
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.css$/,
                use: ["style-loader", "css-loader"],
            },
        ],
    },
    devtool: "source-map",
};
