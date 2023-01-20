import ReactFlow, {
    MiniMap,
    Controls,
    ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { layoutTree } from './tree-layout';
import { TreeDescription } from './tree-description';


interface QueryGraphProps {
    treeDescription: TreeDescription;
}

export function QueryGraph({treeDescription}: QueryGraphProps) {
  const layout = layoutTree(treeDescription);
  console.log(layout);

    return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        elementsSelectable={false}
        fitView
      >
      <MiniMap zoomable={true} pannable={true}/>
      <Controls showInteractive={false}/>
    </ReactFlow>
    </ReactFlowProvider>
  );
};
