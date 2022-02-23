import {merge} from "webpack-merge";
import commonConfig from "./common.config";
import {GenerateSW} from "workbox-webpack-plugin";

const prodConfig = merge(commonConfig, {
    mode: "production",
    devtool: "source-map",
    plugins: [
        new GenerateSW({
            sourcemap: false,
            skipWaiting: true,
            clientsClaim: true,
            ignoreURLParametersMatching: [/./],
            include: [/^bundle.js$/, /^index.html$/],
        }),
    ],
});

export default prodConfig;
