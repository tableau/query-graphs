import { IRenderMime } from '@jupyterlab/rendermime-interfaces';


import { JSONObject } from '@phosphor/coreutils';


import { Widget } from '@phosphor/widgets';

/**
 * The default mime type for the extension.
 */
const MIME_TYPE = 'application/vnd.tableau.hyper-queryplan';

/**
 * The class name added to the extension.
 */
const CLASS_NAME = 'mimerenderer-hyper_queryplan';

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
    this.node.textContent = JSON.stringify(data);
    
    return Promise.resolve();
  }

  private _mimeType: string;
}

/**
 * A mime renderer factory for hyper_queryplan data.
 */
export const rendererFactory: IRenderMime.IRendererFactory = {
  safe: true,
  mimeTypes: [MIME_TYPE],
  createRenderer: options => new OutputWidget(options)
};

/**
 * Extension definition.
 */
const extension: IRenderMime.IExtension = {
  id: '@tableau/query-graphs-jupyterlab-extension:plugin',
  rendererFactory,
  rank: 0,
  dataType: 'json',
  fileTypes: [
    {
      name: 'hyper_queryplan',
      mimeTypes: [MIME_TYPE],
      extensions: ['.plan.json']
    }
  ],
  documentWidgetFactoryOptions: {
    name: 'Query Plan Viewer',
    primaryFileType: 'hyper_queryplan',
    fileTypes: ['hyper_queryplan'],
    defaultFor: ['hyper_queryplan']
  }
};

export default extension;
