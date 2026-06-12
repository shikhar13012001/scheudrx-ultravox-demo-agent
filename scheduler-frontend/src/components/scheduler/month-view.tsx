"use client";

// Month grid: event chips per day, "+N more" jumps to day view.

import { useMemo } from "react";
import { format, isSameDay, isSameMonth, isToday } from "date-fns";
import { cn } from "@/lib/utils";
import type { CalEvent } from "@/lib/types";
import type { DoctorWithColor } from "@/hooks/use-scheduler";

const MAX_CHIPS = 3;

interface MonthViewProps {
  days: Date[]; // full weeks covering the month (multiple of 7)
  anchor: Date;
  events: CalEvent[];
  doctors: DoctorWithColor[];
  onDayClick: (day: Date) => void;
  onEventClick: (event: CalEvent) => void;
}

export function MonthView({
  days,
  anchor,
  events,
  doctors,
  onDayClick,
  onEventClick,
}: MonthViewProps) {
  const doctorById = useMemo(() => new Map(doctors.map((d) => [d.id, d])), [doctors]);

  const eventsByDay = useMemo(
    () =>
      days.map((day) =>
        events
          .filter((e) => isSameDay(new Date(e.startTs), day))
          .sort((a, b) => a.startTs - b.startTs),
      ),
    [days, events],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="px-2 py-1.5 text-center text-xs font-medium uppercase text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      <div
        className="grid flex-1 grid-cols-7 overflow-y-auto"
        style={{ gridAutoRows: "minmax(110px, 1fr)" }}
      >
        {days.map((day, i) => {
          const dayEvents = eventsByDay[i];
          const overflow = dayEvents.length - MAX_CHIPS;

          return (
            <div
              key={day.toISOString()}
              className={cn(
                "flex cursor-pointer flex-col gap-1 border-b border-l p-1.5 transition-colors hover:bg-muted/30",
                !isSameMonth(day, anchor) && "bg-muted/20 text-muted-foreground",
              )}
              onClick={() => onDayClick(day)}
            >
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                  isToday(day) && "bg-primary text-primary-foreground",
                )}
              >
                {format(day, "d")}
              </div>

              {dayEvents.slice(0, MAX_CHIPS).map((event) => {
                const doctor = doctorById.get(event.doctorId);
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(event);
                    }}
                    className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] font-medium text-white hover:opacity-90"
                    style={{ backgroundColor: doctor?.color ?? "#64748b" }}
                  >
                    <span className="shrink-0 opacity-90">
                      {format(new Date(event.startTs), "HH:mm")}
                    </span>
                    <span className="truncate">{event.title}</span>
                  </button>
                );
              })}

              {overflow > 0 && (
                <div className="px-1 text-[11px] font-medium text-muted-foreground">
                  +{overflow} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
