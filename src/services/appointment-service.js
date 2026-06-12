// Calendar-integrated appointment booking, rescheduling, and cancellation.
// Creates and manages nettu-scheduler events alongside Supabase appointment records.

const crypto    = require("node:crypto");
const clinicSvc = require("./clinic-service");
const doctorSvc = require("./doctor-service");
const { epochToISO, toDateString } = require("./availability-service");

const SAFE_TITLE_PREFIX = "Appointment";

// Build a privacy-safe calendar event title.
function eventTitle(doctorName) {
  return `${SAFE_TITLE_PREFIX}${doctorName ? ` - ${doctorName}` : ""}`;
}

// Parse an ISO 8601 string to epoch milliseconds. Throws INVALID_DATE on failure.
function isoToEpochMs(iso) {
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) {
    throw Object.assign(new Error(`Invalid ISO date: '${iso}'`), { code: "INVALID_DATE", statusCode: 400 });
  }
  return ms;
}

// Append an entry to the appointment's auditHistory JSONB array.
function buildAuditEntry(action, { actor, reason, oldStart, newStart, oldEnd, newEnd }) {
  return {
    action,
    actor:     actor ?? "system",
    reason:    reason ?? null,
    oldStart:  oldStart ?? null,
    oldEnd:    oldEnd   ?? null,
    newStart:  newStart ?? null,
    newEnd:    newEnd   ?? null,
    timestamp: new Date().toISOString(),
  };
}

// ─── Book ─────────────────────────────────────────────────────────────────────

// opts: { clinicId, doctorId, start, end?, patient: { name, phone, email? },
//         appointmentType?, reason?, source? }
async function bookAppointment(nettuClient, supabaseClient, opts, log) {
  const { clinicId, doctorId, patientId, start, end, patient, appointmentType, reason, source = "system" } = opts;

  const clinic      = await clinicSvc.requireActiveClinic(supabaseClient, clinicId);
  const doctor      = await doctorSvc.requireActiveDoctor(supabaseClient, doctorId, clinicId);
  const clinicRules = clinicSvc.getSchedulingRules(clinic);
  const doctorRules = doctorSvc.getSchedulingRules(doctor, clinicRules);
  const timezone    = doctorRules.timezone;

  if (!clinic.schedulerServiceId) {
    throw Object.assign(
      new Error("Clinic calendar is not configured — run the setup script first"),
      { code: "SCHEDULER_API_ERROR", statusCode: 500 },
    );
  }

  const startMs = isoToEpochMs(start);
  const endMs   = end ? isoToEpochMs(end) : startMs + doctorRules.slotDurationMins * 60 * 1000;

  if (startMs <= Date.now()) {
    throw Object.assign(new Error("Slot start time is in the past"), { code: "SLOT_NOT_AVAILABLE", statusCode: 422 });
  }

  // Check booking window compliance.
  const maxBookingMs = Date.now() + clinicRules.maxBookingWindowDays * 24 * 60 * 60 * 1000;
  if (startMs > maxBookingMs) {
    throw Object.assign(
      new Error(`Slot is outside the ${clinicRules.maxBookingWindowDays}-day booking window`),
      { code: "OUTSIDE_BOOKING_WINDOW", statusCode: 422 },
    );
  }

  log?.info({ clinicId, doctorId, start, source }, "[appointmentSvc] booking appointment");

  const durationMs = endMs - startMs;

  // Create a busy calendar event in nettu (marks slot as taken).
  // serviceId links the event to the clinic's service for conflict detection.
  let nettuEvent;
  try {
    nettuEvent = await nettuClient.createEvent(doctor.schedulerDoctorId, {
      calendarId: doctor.schedulerCalendarId,
      startTs:    startMs,
      durationMs,
      busy:       true,
      serviceId:  clinic.schedulerServiceId,
      metadata:   { appointmentSource: source },
    });
  } catch (err) {
    if (err.httpStatus === 409) {
      throw Object.assign(
        new Error("The selected slot is no longer available"),
        { code: "SLOT_NOT_AVAILABLE", statusCode: 409 },
      );
    }
    throw Object.assign(
      new Error(`Scheduler API error: ${err.message}`),
      { code: "SCHEDULER_API_ERROR", statusCode: 502 },
    );
  }

  // Persist to Supabase.
  const now           = new Date().toISOString();
  const appointmentId = `apt_${crypto.randomUUID()}`;
  const auditEntry    = buildAuditEntry("created", { actor: source, reason });

  const { data: appointment, error } = await supabaseClient
    .from("Appointment")
    .insert({
      id:               appointmentId,
      clinicId,
      patientId:        patientId ?? null,
      doctorId,
      timeslot:         start,
      symptoms:         reason ?? null,
      status:           "booked",
      schedulerEventId: nettuEvent?.id ?? null,
      source,
      auditHistory:     [auditEntry],
      createdAt:        now,
      updatedAt:        now,
    })
    .select()
    .single();

  if (error) {
    // DB failed after the nettu event was created — log for manual reconciliation.
    log?.error(
      { err: error, nettuEventId: nettuEvent?.id, clinicId, doctorId },
      "[appointmentSvc] DB insert failed after nettu event created — manual reconciliation needed",
    );
    throw Object.assign(new Error("Database error saving appointment"), { code: "DATABASE_ERROR", statusCode: 500 });
  }

  log?.info({ appointmentId, nettuEventId: nettuEvent?.id, doctorId, clinicId }, "[appointmentSvc] appointment booked");

  return {
    appointmentId:        appointment.id,
    schedulerEventId:     appointment.schedulerEventId,
    clinicId:             appointment.clinicId,
    doctorId:             appointment.doctorId,
    start:                epochToISO(startMs, timezone),
    end:                  epochToISO(endMs,   timezone),
    status:               appointment.status,
    patient:              { name: patient?.name ?? null, phone: patient?.phone ?? null },
    source:               appointment.source,
  };
}

// ─── Reschedule ───────────────────────────────────────────────────────────────

// opts: { appointmentId, clinicId, doctorId, newStart, newEnd?, reason?, source? }
async function rescheduleAppointment(nettuClient, supabaseClient, opts, log) {
  const { appointmentId, clinicId, doctorId, newStart, newEnd, reason, source = "system" } = opts;

  // Fetch the existing appointment.
  const { data: appt, error: fetchErr } = await supabaseClient
    .from("Appointment")
    .select("*")
    .eq("id", appointmentId)
    .maybeSingle();

  if (fetchErr) throw Object.assign(new Error(`DB error: ${fetchErr.message}`), { code: "DATABASE_ERROR", statusCode: 500 });
  if (!appt)    throw Object.assign(new Error(`Appointment '${appointmentId}' not found`), { code: "APPOINTMENT_NOT_FOUND", statusCode: 404 });

  if (appt.clinicId !== clinicId) {
    throw Object.assign(
      new Error(`Appointment does not belong to clinic '${clinicId}'`),
      { code: "APPOINTMENT_NOT_FOUND", statusCode: 404 },
    );
  }
  if (appt.status === "cancelled") {
    throw Object.assign(new Error("Cannot reschedule a cancelled appointment"), { code: "RESCHEDULE_NOT_ALLOWED", statusCode: 422 });
  }

  const clinic      = await clinicSvc.requireActiveClinic(supabaseClient, clinicId);
  const doctor      = await doctorSvc.requireActiveDoctor(supabaseClient, doctorId, clinicId);
  const clinicRules = clinicSvc.getSchedulingRules(clinic);
  const doctorRules = doctorSvc.getSchedulingRules(doctor, clinicRules);
  const timezone    = doctorRules.timezone;

  // Enforce reschedule cutoff.
  if (appt.timeslot) {
    const originalStartMs = new Date(appt.timeslot).getTime();
    const cutoffMs        = clinicRules.rescheduleCutoffHours * 60 * 60 * 1000;
    if (originalStartMs - Date.now() < cutoffMs) {
      throw Object.assign(
        new Error(`Appointments cannot be rescheduled within ${clinicRules.rescheduleCutoffHours} hours of the original start time`),
        { code: "RESCHEDULE_NOT_ALLOWED", statusCode: 422 },
      );
    }
  }

  const newStartMs = isoToEpochMs(newStart);
  const newEndMs   = newEnd ? isoToEpochMs(newEnd) : newStartMs + doctorRules.slotDurationMins * 60 * 1000;

  if (newStartMs <= Date.now()) {
    throw Object.assign(new Error("New slot start time is in the past"), { code: "SLOT_NOT_AVAILABLE", statusCode: 422 });
  }

  log?.info({ appointmentId, newStart, source }, "[appointmentSvc] rescheduling appointment");

  // Delete the old nettu event and create a new booking.
  if (appt.schedulerEventId && doctor.schedulerDoctorId) {
    try {
      await nettuClient.deleteEvent(doctor.schedulerDoctorId, appt.schedulerEventId);
    } catch (err) {
      log?.warn({ err, appointmentId, eventId: appt.schedulerEventId }, "[appointmentSvc] could not delete old nettu event — proceeding");
    }
  }

  const newDurationMs = newEndMs - newStartMs;
  let newNettuEvent = null;
  try {
    newNettuEvent = await nettuClient.createEvent(doctor.schedulerDoctorId, {
      calendarId: doctor.schedulerCalendarId,
      startTs:    newStartMs,
      durationMs: newDurationMs,
      busy:       true,
      serviceId:  clinic.schedulerServiceId,
      metadata:   { appointmentSource: source },
    });
  } catch (err) {
    if (err.httpStatus === 409) {
      throw Object.assign(new Error("The new slot is no longer available"), { code: "SLOT_NOT_AVAILABLE", statusCode: 409 });
    }
    throw Object.assign(new Error(`Scheduler API error: ${err.message}`), { code: "SCHEDULER_API_ERROR", statusCode: 502 });
  }

  const now        = new Date().toISOString();
  const auditEntry = buildAuditEntry("rescheduled", {
    actor:    source,
    reason,
    oldStart: appt.timeslot,
    newStart,
  });

  const currentHistory = Array.isArray(appt.auditHistory) ? appt.auditHistory : [];

  const { data: updated, error: updateErr } = await supabaseClient
    .from("Appointment")
    .update({
      timeslot:         newStart,
      status:           "rescheduled",
      schedulerEventId: newNettuEvent?.id ?? null,
      rescheduledAt:    now,
      rescheduleReason: reason ?? null,
      oldStart:         appt.timeslot ?? null,
      oldEnd:           null,
      auditHistory:     [...currentHistory, auditEntry],
      updatedAt:        now,
    })
    .eq("id", appointmentId)
    .select()
    .single();

  if (updateErr) {
    log?.error({ err: updateErr, appointmentId }, "[appointmentSvc] DB update failed after reschedule");
    throw Object.assign(new Error("Database error updating appointment"), { code: "DATABASE_ERROR", statusCode: 500 });
  }

  log?.info({ appointmentId, newStart, newNettuEventId: newNettuEvent?.id }, "[appointmentSvc] appointment rescheduled");

  return {
    appointmentId,
    status:   "rescheduled",
    oldStart: appt.timeslot ?? null,
    oldEnd:   null,
    newStart: epochToISO(newStartMs, timezone),
    newEnd:   epochToISO(newEndMs,   timezone),
  };
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

// opts: { appointmentId, clinicId, reason?, source? }
async function cancelAppointment(nettuClient, supabaseClient, opts, log) {
  const { appointmentId, clinicId, reason, source = "system" } = opts;

  const { data: appt, error: fetchErr } = await supabaseClient
    .from("Appointment")
    .select("*")
    .eq("id", appointmentId)
    .maybeSingle();

  if (fetchErr) throw Object.assign(new Error(`DB error: ${fetchErr.message}`), { code: "DATABASE_ERROR", statusCode: 500 });
  if (!appt)    throw Object.assign(new Error(`Appointment '${appointmentId}' not found`), { code: "APPOINTMENT_NOT_FOUND", statusCode: 404 });

  if (appt.clinicId !== clinicId) {
    throw Object.assign(new Error(`Appointment does not belong to clinic '${clinicId}'`), { code: "APPOINTMENT_NOT_FOUND", statusCode: 404 });
  }
  if (appt.status === "cancelled") {
    throw Object.assign(new Error("Appointment is already cancelled"), { code: "APPOINTMENT_ALREADY_CANCELLED", statusCode: 422 });
  }

  const clinic      = await clinicSvc.requireActiveClinic(supabaseClient, clinicId);
  const clinicRules = clinicSvc.getSchedulingRules(clinic);

  // Enforce cancellation cutoff.
  if (appt.timeslot) {
    const appointmentMs = new Date(appt.timeslot).getTime();
    const cutoffMs      = clinicRules.cancellationCutoffHours * 60 * 60 * 1000;
    if (appointmentMs - Date.now() < cutoffMs) {
      throw Object.assign(
        new Error(`Appointments cannot be cancelled within ${clinicRules.cancellationCutoffHours} hours of the start time`),
        { code: "CANCELLATION_NOT_ALLOWED", statusCode: 422 },
      );
    }
  }

  log?.info({ appointmentId, clinicId, source }, "[appointmentSvc] cancelling appointment");

  // Remove the event from nettu-scheduler.
  if (appt.schedulerEventId && appt.doctorId) {
    const { data: doctor } = await supabaseClient
      .from("Doctor")
      .select("schedulerDoctorId")
      .eq("id", appt.doctorId)
      .maybeSingle();

    if (doctor?.schedulerDoctorId) {
      try {
        await nettuClient.deleteEvent(doctor.schedulerDoctorId, appt.schedulerEventId);
      } catch (err) {
        log?.warn({ err, appointmentId, eventId: appt.schedulerEventId }, "[appointmentSvc] could not delete nettu event — continuing with DB cancel");
      }
    }
  }

  const now        = new Date().toISOString();
  const auditEntry = buildAuditEntry("cancelled", { actor: source, reason });
  const currentHistory = Array.isArray(appt.auditHistory) ? appt.auditHistory : [];

  const { error: updateErr } = await supabaseClient
    .from("Appointment")
    .update({
      status:             "cancelled",
      cancelledAt:        now,
      cancellationReason: reason ?? null,
      source,
      auditHistory:       [...currentHistory, auditEntry],
      updatedAt:          now,
    })
    .eq("id", appointmentId);

  if (updateErr) {
    log?.error({ err: updateErr, appointmentId }, "[appointmentSvc] DB update failed after cancel");
    throw Object.assign(new Error("Database error cancelling appointment"), { code: "DATABASE_ERROR", statusCode: 500 });
  }

  log?.info({ appointmentId }, "[appointmentSvc] appointment cancelled");

  return {
    appointmentId,
    status:      "cancelled",
    clinicId,
    doctorId:    appt.doctorId,
    cancelledAt: now,
    reason:      reason ?? null,
  };
}

module.exports = { bookAppointment, rescheduleAppointment, cancelAppointment };
