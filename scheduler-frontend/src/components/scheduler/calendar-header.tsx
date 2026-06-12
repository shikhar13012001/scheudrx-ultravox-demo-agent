"use client";

import { addDays, addMonths, addWeeks, endOfWeek, format, isSameMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ViewMode } from "@/hooks/use-scheduler";

interface CalendarHeaderProps {
  view: ViewMode;
  anchor: Date;
  loading: boolean;
  onViewChange: (view: ViewMode) => void;
  onAnchorChange: (date: Date) => void;
  onRefresh: () => void;
}

function rangeLabel(view: ViewMode, anchor: Date): string {
  if (view === "day") return format(anchor, "EEEE, d MMMM yyyy");
  if (view === "month") return format(anchor, "MMMM yyyy");
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const end = endOfWeek(anchor, { weekStartsOn: 1 });
  if (isSameMonth(start, end)) return `${format(start, "d")} – ${format(end, "d MMM yyyy")}`;
  return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
}

export function CalendarHeader({
  view,
  anchor,
  loading,
  onViewChange,
  onAnchorChange,
  onRefresh,
}: CalendarHeaderProps) {
  const step = (dir: 1 | -1) => {
    if (view === "day") onAnchorChange(addDays(anchor, dir));
    else if (view === "week") onAnchorChange(addWeeks(anchor, dir));
    else onAnchorChange(addMonths(anchor, dir));
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onAnchorChange(new Date())}>
          Today
        </Button>
        <div className="flex items-center">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => step(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => step(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="text-lg font-semibold tracking-tight">{rangeLabel(view, anchor)}</h2>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
        <Tabs value={view} onValueChange={(v) => onViewChange(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
