import {useStore} from "reactflow";
import {useEffect, useRef} from "react";

export interface NodeDimension {
    width: number;
    height: number;
}
export type NodeDimensions = Map<string, NodeDimension>;

function useMemoCompare<T>(next: T, compare: (a: T | undefined, b: T) => boolean): T | undefined {
    // Ref for storing previous value
    const previousRef = useRef<T>();
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

function equalWithEpsilon(a: number, b: number) {
    return Math.abs(a - b) < 0.5;
}

function compareNodeSizes(a: NodeDimensions | undefined, b: NodeDimensions): boolean {
    if (a === undefined) return false;
    if (a.size !== b.size) return false;
    for (const [key, val] of a) {
        const other = b.get(key);
        if (!other) return false;
        if (!equalWithEpsilon(val.height, other.height)) return false;
        if (!equalWithEpsilon(val.width, other.width)) return false;
    }
    return true;
}
export function useNodeSizes() {
    const nodeInternals = useStore(s => s.nodeInternals);
    const sizes = new Map<string, NodeDimension>();
    nodeInternals.forEach((n, k) => {
        if (n.width === undefined || n.width === null) return;
        if (n.height === undefined || n.height === null) return;
        sizes.set(k, {width: n.width, height: n.height});
    });
    return useMemoCompare(sizes, compareNodeSizes);
}
