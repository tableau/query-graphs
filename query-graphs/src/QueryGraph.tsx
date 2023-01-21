import ReactFlow, {
    MiniMap,
    Controls,
    ReactFlowProvider,
    useNodesInitialized,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { layoutTree } from './tree-layout';
import { TreeDescription } from './tree-description';
import { useMemo } from 'react';
import { QueryNode } from './QueryNode';
import { useNodeSizes } from './useNodeSizes';


interface QueryGraphProps {
    treeDescription: TreeDescription;
}

function QueryGraphInternal({treeDescription}: QueryGraphProps) {
  // Layout the tree, using the actual measured sizes of the DOM nodes
  const initialized = useNodesInitialized();
  const nodeSizes = useNodeSizes();
  const layout = useMemo(() => layoutTree(treeDescription, nodeSizes), [treeDescription, nodeSizes]);
  console.log({initialized, layout, nodeSizes});

  const nodeTypes = useMemo(() => ({ querynode: QueryNode }), []);

  return (
    <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeOrigin={[0.5, 0.5]}
        nodeTypes={nodeTypes}
        elementsSelectable={false}
        fitView
        maxZoom = {2}
      >
      <MiniMap zoomable={true} pannable={true}/>
      <Controls showInteractive={false}/>
    </ReactFlow>
  );
};

export function QueryGraph(props: QueryGraphProps) {
  return (
    <ReactFlowProvider>
      <QueryGraphInternal {...props}/>
    </ReactFlowProvider>
  );
}