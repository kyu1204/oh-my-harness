import React from "react";
import { Text, Box } from "ink";
import { HitBar } from "./HitBar.js";
import type { StatsData } from "../data.js";

interface OverviewProps {
  data: StatsData;
}

export function Overview({ data }: OverviewProps): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Active: {data.activeBlocks.length}</Text>
        <Text>  </Text>
        <Text>Events: {data.totalEvents}</Text>
        <Text>  </Text>
        <Text>Block rate: {data.blockRate}%</Text>
      </Box>

      {data.activeBlocks.map(block => (
        <Box key={block.id}>
          <Box width={22}>
            <Text color={block.canBlock ? "cyan" : "gray"}>{block.id}</Text>
          </Box>
          <HitBar blockCount={block.blockCount} allowCount={block.allowCount} />
          <Text> {block.hits} hits</Text>
          {block.blockCount > 0 && <Text color="red"> ({block.blockCount} block)</Text>}
        </Box>
      ))}

      {data.dormantBlocks.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>Dormant (0 hits):</Text>
          {data.dormantBlocks.map(block => (
            <Text key={block.id} dimColor>  ░ {block.id}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
