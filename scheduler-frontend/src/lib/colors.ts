// Stable color assignment for doctors (by list order).

export const DOCTOR_COLORS = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
];

export function doctorColor(index: number): string {
  return DOCTOR_COLORS[index % DOCTOR_COLORS.length];
}
