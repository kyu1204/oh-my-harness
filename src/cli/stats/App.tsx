import React, { useState, useCallback } from "react";
import { Text, Box, useInput, useApp } from "ink";
import { Overview } from "./components/Overview.js";
import { Timeline } from "./components/Timeline.js";
import { Blocks } from "./components/Blocks.js";
import { loadStatsData } from "./data.js";
import type { StatsData, DateRange } from "./data.js";

type ViewType = "overview" | "timeline" | "blocks";

const VIEWS: ViewType[] = ["overview", "timeline", "blocks"];
const VIEW_LABELS: Record<ViewType, string> = {
  overview: "Overview",
  timeline: "Timeline",
  blocks: "Blocks",
};
const DATE_RANGES: DateRange[] = ["all", "week", "today"];

interface AppProps {
  initialData: StatsData;
  projectDir: string;
}

export function App({ initialData, projectDir }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [data, setData] = useState(initialData);
  const [view, setView] = useState<ViewType>("overview");
  const [dateRangeIndex, setDateRangeIndex] = useState(0);
  const [selectedBlockIndex, setSelectedBlockIndex] = useState(0);

  const reload = useCallback(async () => {
    const newData = await loadStatsData(projectDir, DATE_RANGES[dateRangeIndex]);
    setData(newData);
  }, [projectDir, dateRangeIndex]);

  useInput((input, key) => {
    // 뷰 전환: 1/2/3
    if (input === "1") setView("overview");
    if (input === "2") setView("timeline");
    if (input === "3") setView("blocks");

    // 뷰 전환: ←/→
    if (key.leftArrow) {
      const idx = VIEWS.indexOf(view);
      setView(VIEWS[(idx - 1 + VIEWS.length) % VIEWS.length]);
    }
    if (key.rightArrow) {
      const idx = VIEWS.indexOf(view);
      setView(VIEWS[(idx + 1) % VIEWS.length]);
    }

    // Blocks 뷰에서 ↑/↓
    if (view === "blocks") {
      if (key.upArrow) setSelectedBlockIndex(i => Math.max(0, i - 1));
      if (key.downArrow) setSelectedBlockIndex(i => Math.min(data.blocks.length - 1, i + 1));
    }

    // d: 날짜 필터 순환
    if (input === "d") {
      const nextIndex = (dateRangeIndex + 1) % DATE_RANGES.length;
      setDateRangeIndex(nextIndex);
      loadStatsData(projectDir, DATE_RANGES[nextIndex]).then(setData);
    }

    // r: 새로고침
    if (input === "r") reload();

    // q: 종료
    if (input === "q") exit();
  });

  return (
    <Box flexDirection="column">
      {/* 탭 바 */}
      <Box>
        {VIEWS.map((v, i) => (
          <Box key={v} marginRight={2}>
            <Text inverse={view === v} bold={view === v}>
              {` [${i + 1}] ${VIEW_LABELS[v]} `}
            </Text>
          </Box>
        ))}
        <Box flexGrow={1} />
        <Text dimColor>d:filter r:reload q:quit</Text>
      </Box>

      {/* 뷰 렌더링 */}
      <Box marginTop={1}>
        {view === "overview" && <Overview data={data} />}
        {view === "timeline" && <Timeline data={data} />}
        {view === "blocks" && <Blocks data={data} selectedIndex={selectedBlockIndex} />}
      </Box>
    </Box>
  );
}
