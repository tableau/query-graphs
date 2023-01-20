import { memo } from 'react';
import { Handle, Position } from 'reactflow';

function QueryNode({data}) {
    return (
    <>
      <Handle
            type="target"
            position={Position.Top}
            />
      <div>
        {data.name}
      </div>
      <Handle
            type="source"
            position={Position.Bottom}
        />
    </>
    )
}

const memoizedQueryNode = memo(QueryNode)
export { memoizedQueryNode as QueryNode };