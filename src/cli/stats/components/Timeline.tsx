import React from "react";
import { Text, Box } from "ink";
import type { StatsData } from "../data.js";

interface TimelineProps {
  data: StatsData;
}

function intensityChar(count: number, maxCount: number): string {
  if (count === 0) return "░";
  const ratio = count / maxCount;
  if (ratio < 0.33) return "▒";
  if (ratio < 0.66) return "▓";
  return "█";
}

export function Timeline({ data }: TimelineProps): React.ReactElement {
  const { hourlyDistribution, blockRate, peakHour, totalEvents, dateRange } = data;
  const maxCount = Math.max(...hourlyDistribution.map(b => b.total), 1);

  const topHours = [...hourlyDistribution]
    .sort((a, b) => b.total - a.total)
    .filter(b => b.total > 0)
    .slice(0, 5);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Events: {totalEvents}</Text>
        <Text>  </Text>
        <Text>{"Block rate: "}<Text color={blockRate > 20 ? "red" : "green"}>{blockRate}%</Text></Text>
        <Text>  </Text>
        <Text>{"Peak: "}{String(peakHour).padStart(2, "0")}:00</Text>
        <Text>  </Text>
        <Text dimColor>{"Range: "}{dateRange}</Text>
      </Box>

      <Box>
        <Text bold>{"Hour  "}</Text>
        {hourlyDistribution.map(bucket => (
          <Text key={bucket.hour} color={bucket.hour === peakHour ? "yellow" : undefined}>
            {intensityChar(bucket.total, maxCount)}
          </Text>
        ))}
      </Box>
      <Box>
        <Text dimColor>{"      "}</Text>
        <Text dimColor>{"0         1         2   "}</Text>
      </Box>
      <Box>
        <Text dimColor>{"      "}</Text>
        <Text dimColor>{"0    5    0    5    0  3"}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Top hours:</Text>
        {topHours.map(b => (
          <Box key={b.hour}>
            <Text>{"  "}{String(b.hour).padStart(2, "0")}:00{"  "}</Text>
            <Text>{b.total} events</Text>
            {b.blockCount > 0 && <Text color="red">{" ("}{b.blockCount} block{")"}</Text>}
          </Box>
        ))}
        {topHours.length === 0 && (
          <Text dimColor>{"  No events recorded"}</Text>
        )}
      </Box>
    </Box>
  );
}
