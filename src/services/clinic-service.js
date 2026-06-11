// Clinic data access and scheduling-rule helpers.
// All functions return plain objects; callers decide how to respond.

const DEFAULT_RULES = {
  timezone:                       "Asia/Kolkata",
  workingDays:                    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  openingHour:                    9,
  closingHour:                    18,
  defaultAppointmentDurationMins: 30,
  bufferMins:                     5,
  minNoticeHours:                 2,
  maxBookingWindowDays:           14,
  cancellationCutoffHours:        24,
  rescheduleCutoffHours:          24,
};

// ─── Queries ──────────────────────────────────────────────────────────────────

async function getClinic(supabaseClient, clinicId) {
  const { data, error } = await supabaseClient
    .from("Clinic")
    .select("*")
    .eq("id", clinicId)
    .maybeSingle();

  if (error) throw Object.assign(new Error(`DB error fetching clinic: ${error.message}`), { code: "DATABASE_ERROR" });
  return data ?? null;
}

// Validates clinic exists and is active; throws with a structured code on failure.
async function requireActiveClinic(supabaseClient, clinicId) {
  const clinic = await getClinic(supabaseClient, clinicId);
  if (!clinic) {
    throw Object.assign(new Error(`Clinic '${clinicId}' not found`), { code: "CLINIC_NOT_FOUND", statusCode: 404 });
  }
  if (clinic.status && clinic.status !== "active") {
    throw Object.assign(new Error(`Clinic '${clinicId}' is not active`), { code: "CLINIC_INACTIVE", statusCode: 422 });
  }
  return clinic;
}

// Returns the effective scheduling rules for a clinic, filling defaults for any missing columns.
function getSchedulingRules(clinic) {
  return {
    timezone:                       clinic.timezone                       ?? DEFAULT_RULES.timezone,
    workingDays:                    clinic.workingDays                    ?? DEFAULT_RULES.workingDays,
    openingHour:                    clinic.openingHour                    ?? DEFAULT_RULES.openingHour,
    closingHour:                    clinic.closingHour                    ?? DEFAULT_RULES.closingHour,
    defaultAppointmentDurationMins: clinic.defaultAppointmentDurationMins ?? DEFAULT_RULES.defaultAppointmentDurationMins,
    bufferMins:                     clinic.bufferMins                     ?? DEFAULT_RULES.bufferMins,
    minNoticeHours:                 clinic.minNoticeHours                 ?? DEFAULT_RULES.minNoticeHours,
    maxBookingWindowDays:           clinic.maxBookingWindowDays           ?? DEFAULT_RULES.maxBookingWindowDays,
    cancellationCutoffHours:        clinic.cancellationCutoffHours        ?? DEFAULT_RULES.cancellationCutoffHours,
    rescheduleCutoffHours:          clinic.rescheduleCutoffHours          ?? DEFAULT_RULES.rescheduleCutoffHours,
  };
}

// Persist scheduler IDs back to the Clinic row after setup.
async function saveSchedulerIds(supabaseClient, clinicId, { schedulerServiceId }) {
  const now = new Date().toISOString();
  const { error } = await supabaseClient
    .from("Clinic")
    .update({ schedulerServiceId, updatedAt: now })
    .eq("id", clinicId);

  if (error) throw Object.assign(new Error(`DB error saving clinic scheduler IDs: ${error.message}`), { code: "DATABASE_ERROR" });
}

module.exports = { getClinic, requireActiveClinic, getSchedulingRules, saveSchedulerIds, DEFAULT_RULES };
