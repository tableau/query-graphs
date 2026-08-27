import type { NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";

interface GroupBackdropData extends Record<string, unknown> {
  width: number;
  height: number;
  pathData: string;
  points: {x: number; y: number}[];
  color: string;
  groupId: string;
  // "fill" draws the translucent hull/bbox shape (rendered behind query nodes, z-index -1).
  // "markers" draws just the debug vertex dots, as a separate node rendered after every
  // other node with a high z-index, so they're never hidden behind an overlapping backdrop's
  // fill or a query node — see the call site in tree-layout.ts.
  role: "fill" | "markers";
}

export type GroupBackdropNode = Node<GroupBackdropData, "groupBackdrop">;

export function GroupBackdrop({ data }: NodeProps<GroupBackdropNode>) {
  const [fillColor, strokeColor] = (data.color as string).split("|");
  const points = data.points as {x: number; y: number}[];

  return (
    <svg
      width={data.width as number}
      height={data.height as number}
      style={{pointerEvents: "none", overflow: "visible"}}
    >
      {data.role === "fill" && (
        <path
          d={data.pathData as string}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth="2"
        />
      )}
      {data.role === "markers" &&
        points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={5} fill="red" stroke="white" strokeWidth={1} />)}
    </svg>
  );
}
