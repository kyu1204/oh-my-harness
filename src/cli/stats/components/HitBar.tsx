import React from "react";
import { Text } from "ink";

interface HitBarProps {
  blockCount: number;
  allowCount: number;
  maxWidth?: number;
}

export function HitBar({ blockCount, allowCount, maxWidth = 20 }: HitBarProps): React.JSX.Element {
  const total = blockCount + allowCount;
  if (total === 0) return <Text dimColor>{"░".repeat(maxWidth)}</Text>;

  const blockWidth = Math.round((blockCount / total) * maxWidth);
  const allowWidth = maxWidth - blockWidth;

  return (
    <Text>
      <Text color="red">{"█".repeat(blockWidth)}</Text>
      <Text color="green">{"█".repeat(allowWidth)}</Text>
    </Text>
  );
}
