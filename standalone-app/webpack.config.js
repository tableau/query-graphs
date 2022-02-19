const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const {CleanWebpackPlugin} = require("clean-webpack-plugin");

module.exports = {
    entry: "./src/index.tsx",
    mode: "development",
    plugins: [new CleanWebpackPlugin(), new CopyPlugin({patterns: ["src/index.html"]})],
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
    resolve: {
        extensions: [".tsx", ".ts", ".js"],
        // TODO: get rid of this fallback; need to find a replacement for `xml2js`
        fallback: {
            timers: require.resolve("timers-browserify"),
            stream: require.resolve("stream-browserify"),
            buffer: require.resolve("buffer/"),
        },
        alias: {
            /* to enable tracing in a production build:
            'react-dom$': 'react-dom/profiling',
            'scheduler/tracing': 'scheduler/tracing-profiling',
            */
        },
    },
    output: {
        filename: "bundle.js",
        path: path.resolve(__dirname, "dist"),
    },
    devServer: {
        static: {
            directory: path.join(__dirname, "dist"),
        },
    },
};
