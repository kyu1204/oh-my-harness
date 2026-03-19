import React from "react";
import { Text, Box } from "ink";
import type { StatsData, BlockStats } from "../data.js";

interface BlocksProps {
  data: StatsData;
  selectedIndex: number;
}

function BlockDetail({ block }: { block: BlockStats }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text bold color="cyan">{block.name}</Text>
      <Text dimColor>{block.description}</Text>
      <Text>Category: {block.category}</Text>
      <Text>Can block: {block.canBlock ? "yes" : "no"}</Text>
      <Box marginTop={1}>
        <Text bold>Hits: {block.hits}</Text>
        <Text>  </Text>
        <Text color="red">Block: {block.blockCount}</Text>
        <Text>  </Text>
        <Text color="green">Allow: {block.allowCount}</Text>
      </Box>
      {block.lastHit && <Text dimColor>Last hit: {block.lastHit}</Text>}
      {block.lastBlockReason && (
        <Box marginTop={1}>
          <Text color="red">Last block: {block.lastBlockReason}</Text>
        </Box>
      )}
      {Object.keys(block.params).length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Params:</Text>
          {Object.entries(block.params).map(([key, value]) => (
            <Text key={key}>  {key}: {JSON.stringify(value)}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

export function Blocks({ data, selectedIndex }: BlocksProps): React.ReactElement {
  const allBlocks = data.blocks;

  if (allBlocks.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No blocks configured</Text>
      </Box>
    );
  }

  const clampedIndex = Math.max(0, Math.min(selectedIndex, allBlocks.length - 1));
  const selected = allBlocks[clampedIndex];

  return (
    <Box paddingX={1}>
      {/* Block list */}
      <Box flexDirection="column" width={28}>
        {allBlocks.map((block, i) => (
          <Text
            key={i}
            inverse={i === clampedIndex}
            color={block.hits === 0 ? "gray" : undefined}
          >
            {i === clampedIndex ? "▶" : " "} {block.id}
            {block.hits > 0 ? ` (${block.hits})` : ""}
          </Text>
        ))}
      </Box>

      {/* Detail panel */}
      <Box flexDirection="column" borderStyle="single" paddingX={1} flexGrow={1}>
        {selected && <BlockDetail block={selected} />}
      </Box>
    </Box>
  );
}
