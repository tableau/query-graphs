import {merge} from "webpack-merge";
import commonConfig from "./common.config";
import {GenerateSW} from "workbox-webpack-plugin";

const prodConfig = merge(commonConfig, {
    mode: "production",
    devtool: "source-map",
    output: {
        chunkFilename: "chunks/[name].[contenthash].js",
    },
    optimization: {
        // The editor is one lazy capability: its first load prepares every supported language.
        splitChunks: false,
    },
    plugins: [
        new GenerateSW({
            sourcemap: false,
            skipWaiting: true,
            clientsClaim: true,
            ignoreURLParametersMatching: [/./],
            include: [/^bundle\.js$/, /^chunks\/.*\.js$/, /^index.html$/],
        }),
    ],
});

export default prodConfig;
