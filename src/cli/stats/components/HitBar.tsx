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

  let blockWidth = Math.round((blockCount / total) * maxWidth);
  // Guarantee at least 1 red char when there are blocks
  if (blockCount > 0 && blockWidth === 0) blockWidth = 1;
  const allowWidth = maxWidth - blockWidth;

  return (
    <Text>
      <Text color="red">{"█".repeat(blockWidth)}</Text>
      <Text color="green">{"█".repeat(allowWidth)}</Text>
      <Text dimColor> {blockCount}b/{allowCount}a</Text>
    </Text>
  );
}
