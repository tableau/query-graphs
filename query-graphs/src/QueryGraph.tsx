import ReactFlow, {
    MiniMap,
    Controls,
    ReactFlowProvider,
    useStore,
    useNodesInitialized,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { layoutTree } from './tree-layout';
import { TreeDescription } from './tree-description';
import { useMemo } from 'react';
import { QueryNode } from './QueryNode';


interface QueryGraphProps {
    treeDescription: TreeDescription;
}

interface NodeDimensions {
  width : number,
  height : number,
}

function useNodeSizes() {
  const state = useStore((s) => s.nodeInternals);
  return useMemo(() => {
    console.log(state);
    var sizes = new Map<string, NodeDimensions>();
    state.forEach((n, k) => {
      console.log("k", n);
      sizes.set(k, {width: n.width!, height: n.height!});
    });
    return sizes;  
  }, [state])
}

function QueryGraphInternal({treeDescription}: QueryGraphProps) {
  const layout = useMemo(() => layoutTree(treeDescription), [treeDescription]);
  console.log("layout", layout);
  console.log("initialized", useNodesInitialized());
  console.log("nodeSizes", useNodeSizes())
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