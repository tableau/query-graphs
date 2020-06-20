import {IRenderMime} from "@jupyterlab/rendermime-interfaces";
import {JSONObject} from "@phosphor/coreutils";
import {Widget} from "@phosphor/widgets";
import {Message} from "@phosphor/messaging";

import {drawQueryTree} from "@tableau/query-graphs/lib/tree-rendering";
import {loadHyperPlan} from "@tableau/query-graphs/lib/hyper";

/**
 * The default mime type for the extension.
 */
const MIME_TYPE = "application/vnd.tableau.hyper-queryplan";

/**
 * The class name added to the extension.
 */
const CLASS_NAME = "mimerenderer-hyper_queryplan";

/**
 * A widget for rendering hyper_queryplan.
 */
export class OutputWidget extends Widget implements IRenderMime.IRenderer {
    /**
     * Construct a new output widget.
     */
    constructor(options: IRenderMime.IRendererOptions) {
        super();
        this._mimeType = options.mimeType;
        this.addClass(CLASS_NAME);
    }

    /**
     * Render hyper_queryplan into this widget's node.
     */
    renderModel(model: IRenderMime.IMimeModel): Promise<void> {
        let data = model.data[this._mimeType] as JSONObject;
        let treeData = loadHyperPlan(data);
        this._queryGraph = drawQueryTree(this.node, treeData);
        this.update();

        return Promise.resolve();
    }

    /**
     * A message handler invoked on a `'resize'` message.
     */
    protected onResize(_msg: Widget.ResizeMessage): void {
        this.update();
    }

    /**
     * A message handler invoked on a `'after-show'` message.
     */
    protected onAfterShow(_msg: Message): void {
        this.update();
    }

    /**
     * A message handler invoked on an `'update-request'` message.
     */
    protected onUpdateRequest(_msg: Message): void {
        if (this._queryGraph) {
            // Use a minimum height. This is particularly necessary for query-graphs
            // rendered within, e.g., notebooks or interactive consoles.
            this._queryGraph.resize(undefined, Math.max(this.node.clientHeight, 300));
            this._queryGraph.orientRoot();
        }
    }

    private _mimeType: string;
    private _queryGraph: any;
}

/**
 * A mime renderer factory for hyper_queryplan data.
 */
export const rendererFactory: IRenderMime.IRendererFactory = {
    safe: true,
    mimeTypes: [MIME_TYPE],
    createRenderer: options => new OutputWidget(options),
};

/**
 * Extension definition.
 */
const extension: IRenderMime.IExtension = {
    id: "@tableau/query-graphs-jupyterlab-extension:plugin",
    rendererFactory,
    rank: 0,
    dataType: "json",
    fileTypes: [
        {
            name: "hyper_queryplan",
            displayName: "Hyper Query Plan",
            mimeTypes: [MIME_TYPE],
            extensions: [".plan.json"],
            iconClass: "jp-MaterialIcon qg-querygraphs-icon",
        },
    ],
    documentWidgetFactoryOptions: {
        name: "Query Plan Viewer",
        primaryFileType: "hyper_queryplan",
        fileTypes: ["hyper_queryplan"],
        defaultFor: ["hyper_queryplan"],
    },
};

export default extension;
