// `prettier` does not yet support `import type`
// eslint-disable-next-line prettier/prettier
import type { Configuration } from "webpack";
import path from "path";
import CopyPlugin from "copy-webpack-plugin";
import { CreateExamplesListPlugin } from "./webpack-create-examples-list";

const config: Configuration = {
    mode: "development",
    devtool: 'inline-source-map',
    plugins: [
        new CopyPlugin({patterns: ["src/index.html", "examples/**"]}),
        new CreateExamplesListPlugin(),
    ],
    entry: "./src/index.tsx",
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
        clean: true,
    },
};

export default config;