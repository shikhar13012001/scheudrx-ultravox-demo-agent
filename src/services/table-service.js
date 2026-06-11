// Raw DB fetch helpers extracted from tool routes.
// Each function performs exactly one query with no business logic.

const crypto = require("node:crypto");

function dbErr(msg) {
  return Object.assign(new Error(`DB error ${msg}`), { code: "DATABASE_ERROR", statusCode: 500 });
}

// ─── Doctors ──────────────────────────────────────────────────────────────────

async function listActiveDoctors(supabase, clinicId) {
  const { data, error } = await supabase
    .from("Doctor")
    .select("id, fullName, specialty, qualification, languages, feeInr, schedulerDoctorId, schedulerCalendarId")
    .eq("clinicId", clinicId)
    .eq("isActive", true);
  if (error) throw dbErr(`listing doctors: ${error.message}`);
  return data ?? [];
}

// ─── Patients ─────────────────────────────────────────────────────────────────

async function findPatientByPhone(supabase, clinicId, phone) {
  const { data, error } = await supabase
    .from("Patient")
    .select("*")
    .eq("contactNumber", phone)
    .eq("clinicId", clinicId)
    .maybeSingle();
  if (error) throw dbErr(`finding patient: ${error.message}`);
  return data ?? null;
}

async function createPatient(supabase, clinicId, phone) {
  const { data, error } = await supabase
    .from("Patient")
    .insert({
      id:            `pat_${crypto.randomUUID()}`,
      clinicId,
      fullName:      "",
      contactNumber: phone,
      createdAt:     new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw dbErr(`creating patient: ${error.message}`);
  return data;
}

async function updatePatientFields(supabase, patientId, patch) {
  let query;
  if (Object.keys(patch).length === 0) {
    query = supabase
      .from("Patient")
      .select("id, fullName, age, gender, clinicId, contactNumber")
      .eq("id", patientId);
  } else {
    query = supabase
      .from("Patient")
      .update(patch)
      .eq("id", patientId)
      .select("id, fullName, age, gender, clinicId, contactNumber");
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw dbErr(`updating patient: ${error.message}`);
  return data ?? null;
}

module.exports = { listActiveDoctors, findPatientByPhone, createPatient, updatePatientFields };
