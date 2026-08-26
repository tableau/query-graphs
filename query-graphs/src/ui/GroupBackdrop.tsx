import type { NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";

interface GroupBackdropData extends Record<string, unknown> {
  width: number;
  height: number;
  pathData: string;
  color: string;
  groupId: string;
}

export type GroupBackdropNode = Node<GroupBackdropData, "groupBackdrop">;

export function GroupBackdrop({ data }: NodeProps<GroupBackdropNode>) {
  const [fillColor, strokeColor] = (data.color as string).split("|");

  return (
    <svg
      width={data.width as number}
      height={data.height as number}
      style={{pointerEvents: "none", overflow: "visible"}}
    >
      <path
        d={data.pathData as string}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth="2"
      />
    </svg>
  );
}
