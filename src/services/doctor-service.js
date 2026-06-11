// Doctor data access and scheduling-rule helpers.

// ─── Queries ──────────────────────────────────────────────────────────────────

async function getDoctor(supabaseClient, doctorId) {
  const { data, error } = await supabaseClient
    .from("Doctor")
    .select("*")
    .eq("id", doctorId)
    .maybeSingle();

  if (error) throw Object.assign(new Error(`DB error fetching doctor: ${error.message}`), { code: "DATABASE_ERROR" });
  return data ?? null;
}

// Validates doctor exists, is active, and belongs to the given clinic.
async function requireActiveDoctor(supabaseClient, doctorId, clinicId) {
  const doctor = await getDoctor(supabaseClient, doctorId);

  if (!doctor) {
    throw Object.assign(new Error(`Doctor '${doctorId}' not found`), { code: "DOCTOR_NOT_FOUND", statusCode: 404 });
  }
  if (doctor.clinicId !== clinicId) {
    throw Object.assign(
      new Error(`Doctor '${doctorId}' does not belong to clinic '${clinicId}'`),
      { code: "DOCTOR_NOT_IN_CLINIC", statusCode: 422 },
    );
  }
  if (doctor.isActive === false) {
    throw Object.assign(new Error(`Doctor '${doctorId}' is not active`), { code: "DOCTOR_INACTIVE", statusCode: 422 });
  }

  return doctor;
}

// Merges doctor-level scheduling rules on top of clinic defaults.
// Doctor fields are only applied when explicitly set (not null/undefined).
function getSchedulingRules(doctor, clinicRules) {
  return {
    timezone:             doctor.timezone              ?? clinicRules.timezone,
    workingDays:          doctor.workingDaysOverride   ?? clinicRules.workingDays,
    workingHoursStart:    doctor.workingHoursStart     ?? `${String(clinicRules.openingHour).padStart(2, "0")}:00`,
    workingHoursEnd:      doctor.workingHoursEnd       ?? `${String(clinicRules.closingHour).padStart(2, "0")}:00`,
    unavailableDates:     doctor.unavailableDates      ?? [],
    slotDurationMins:     doctor.slotDurationOverrideMins ?? clinicRules.defaultAppointmentDurationMins,
    bufferMins:           doctor.bufferOverrideMins    ?? clinicRules.bufferMins,
  };
}

// Persist scheduler IDs back to the Doctor row after setup.
async function saveSchedulerIds(supabaseClient, doctorId, { schedulerDoctorId, schedulerCalendarId }) {
  const now = new Date().toISOString();
  const { error } = await supabaseClient
    .from("Doctor")
    .update({ schedulerDoctorId, schedulerCalendarId, updatedAt: now })
    .eq("id", doctorId);

  if (error) throw Object.assign(new Error(`DB error saving doctor scheduler IDs: ${error.message}`), { code: "DATABASE_ERROR" });
}

// ─── Doctor name matching ──────────────────────────────────────────────────────

// Normalise a name for comparison: lowercase, strip leading "Dr."/"Dr ", collapse spaces.
function normaliseName(str) {
  return (str ?? "")
    .toLowerCase()
    .replace(/^dr\.?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Score how well `queryWords` (from the caller's spoken text) match `nameWords`.
function wordOverlapScore(nameWords, queryWords) {
  if (!queryWords.length) return 0;
  const hits = queryWords.filter((qw) =>
    nameWords.some((nw) => nw === qw || nw.startsWith(qw) || qw.startsWith(nw)),
  );
  return hits.length / queryWords.length;
}

// Find the best matching doctor from `doctors` for a spoken `query` like "Dr. Sharma" or "Priya".
// Returns the matched doctor row or null if nothing scores above the 0.5 threshold.
function matchDoctorByName(doctors, query) {
  if (!query || !doctors?.length) return null;

  const normQuery  = normaliseName(query);
  const queryWords = normQuery.split(" ").filter(Boolean);

  let best      = null;
  let bestScore = 0;

  for (const doc of doctors) {
    const normName  = normaliseName(doc.fullName ?? "");
    const nameWords = normName.split(" ").filter(Boolean);

    let score;
    if (normName === normQuery) {
      score = 1.0;
    } else if (normName.includes(normQuery) || normQuery.includes(normName)) {
      score = 0.9;
    } else {
      score = wordOverlapScore(nameWords, queryWords);
    }

    if (score > bestScore) {
      bestScore = score;
      best      = doc;
    }
  }

  return bestScore >= 0.5 ? best : null;
}

module.exports = { getDoctor, requireActiveDoctor, getSchedulingRules, saveSchedulerIds, matchDoctorByName };
