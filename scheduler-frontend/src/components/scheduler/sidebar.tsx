"use client";

import { CalendarClock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ClinicInfo, DoctorWithColor } from "@/hooks/use-scheduler";

interface SidebarProps {
  clinics: ClinicInfo[];
  clinicId: string | null;
  onClinicChange: (clinicId: string) => void;
  clinic: ClinicInfo | null;
  doctors: DoctorWithColor[];
  visibleDoctors: Set<string>;
  loading: boolean;
  anchor: Date;
  onAnchorChange: (date: Date) => void;
  onToggleDoctor: (doctorId: string) => void;
  onNewEvent: () => void;
  onEditSchedule: (doctor: DoctorWithColor) => void;
}

export function Sidebar({
  clinics,
  clinicId,
  onClinicChange,
  clinic,
  doctors,
  visibleDoctors,
  loading,
  anchor,
  onAnchorChange,
  onToggleDoctor,
  onNewEvent,
  onEditSchedule,
}: SidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4">
      <div>
        {clinics.length > 1 ? (
          <>
            <label
              htmlFor="clinic-select"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Clinic
            </label>
            <select
              id="clinic-select"
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm font-semibold outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              value={clinicId ?? ""}
              onChange={(e) => onClinicChange(e.target.value)}
            >
              {clinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <h1 className="text-xl font-bold tracking-tight">
            {clinic?.name ?? "Clinic Scheduler"}
          </h1>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{clinic?.timezone ?? ""}</p>
      </div>

      <Button onClick={onNewEvent} className="justify-start gap-2">
        <Plus className="h-4 w-4" />
        New appointment
      </Button>

      <Calendar
        mode="single"
        selected={anchor}
        onSelect={(d) => d && onAnchorChange(d)}
        weekStartsOn={1}
        className="rounded-lg border"
      />

      <Separator />

      <div className="min-h-0 flex-1">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Doctors
        </h3>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="space-y-1">
            {doctors.map((doctor) => {
              const visible = visibleDoctors.has(doctor.id);
              return (
                <div
                  key={doctor.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60",
                    !visible && "opacity-45",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => onToggleDoctor(doctor.id)}
                    title={visible ? "Hide calendar" : "Show calendar"}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-white/40"
                      style={{ backgroundColor: doctor.color }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {doctor.fullName}
                      </span>
                      {doctor.specialty && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {doctor.specialty}
                        </span>
                      )}
                    </span>
                  </button>

                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => onEditSchedule(doctor)}
                          disabled={!doctor.hasCalendar}
                        >
                          <CalendarClock className="h-4 w-4" />
                        </Button>
                      }
                    />
                    <TooltipContent side="right">Working hours</TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
            {doctors.length === 0 && (
              <p className="px-2 text-sm text-muted-foreground">No active doctors found.</p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
