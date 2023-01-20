import { useStore } from 'reactflow';
import { useEffect, useRef } from 'react';
import { NodeDimensions } from './QueryGraph';

function useMemoCompare(next, compare) {
  // Ref for storing previous value
  const previousRef = useRef();
  const previous = previousRef.current;
  // Pass previous and next value to compare function
  // to determine whether to consider them equal.
  const isEqual = compare(previous, next);
  // If not equal update previousRef to next value.
  // We only update if not equal so that this hook continues to return
  // the same old value if compare keeps returning true.
  useEffect(() => {
    if (!isEqual) {
      previousRef.current = next;
    }
  });
  // Finally, if equal then return the previous value
  return isEqual ? previous : next;
}
function compareNodeSizes(a: Map<string, NodeDimensions>, b: Map<string, NodeDimensions>) {
  if (!a || !b)
    return false;
  if (a.size !== b.size)
    return false;
  for (var [key, val] of a) {
    const other = b.get(key);
    if (!other)
      return false;
    if (val.height != other.height)
      return false;
    if (val.width != other.width)
      return false;
  }
  return true;
}
export function useNodeSizes() {
  const state = useStore((s) => s.nodeInternals);

  var sizes = new Map<string, NodeDimensions>();
  state.forEach((n, k) => {
    sizes.set(k, { width: n.width!, height: n.height! });
  });
  return useMemoCompare(sizes, compareNodeSizes);
}
