import { TreeDescription } from "./tree-description";
import ReactFlow, {
    MiniMap,
    Controls,
} from 'reactflow';

import 'reactflow/dist/style.css';

interface QueryGraphProps {
    treeDescription: TreeDescription;
}

const initialNodes = [
  {
    id: 'hidden-1',
    type: 'input',
    data: { label: 'Node 1' },
    position: { x: 250, y: 5 },
  },
  { id: 'hidden-2', data: { label: 'Node 2' }, position: { x: 100, y: 100 } },
  { id: 'hidden-3', data: { label: 'Node 3' }, position: { x: 400, y: 100 } },
  { id: 'hidden-4', data: { label: 'Node 4' }, position: { x: 400, y: 200 } },
];

const initialEdges = [
  { id: 'hidden-e1-2', source: 'hidden-1', target: 'hidden-2' },
  { id: 'hidden-e1-3', source: 'hidden-1', target: 'hidden-3' },
  { id: 'hidden-e3-4', source: 'hidden-3', target: 'hidden-4' },
];

export function QueryGraph({treeDescription}: QueryGraphProps) {
    return (
    <ReactFlow
      nodes={initialNodes}
      edges={initialEdges}
    >
      <MiniMap />
      <Controls />
    </ReactFlow>
  );
};
