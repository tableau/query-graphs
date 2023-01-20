import ReactFlow, {
    MiniMap,
    Controls,
    ReactFlowProvider,
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

export interface NodeDimensions {
  width : number,
  height : number,
}

function QueryGraphInternal({treeDescription}: QueryGraphProps) {
  // Layout the tree, using the actual measured sizes of the DOM nodes
  const nodeSizes = useNodeSizes();
  const layout = useMemo(() => {
    return layoutTree(treeDescription);
  }, [treeDescription, nodeSizes]);
  console.log("layout", layout);
  console.log("nodeSizes", useNodeSizes());

  const nodeTypes = useMemo(() => ({ querynode: QueryNode }), []);

  return (
    <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        elementsSelectable={false}
        maxZoom = {2}
        fitView
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