const { Router } = require("express");
const crypto = require("node:crypto");

function createToolsRouter(supabaseClient) {
  const router = Router();

  // POST /tools/patients/identify
  // Look up patient by contactNumber + clinicId, create if not found.
  router.post("/patients/identify", async (req, res) => {
    const { contactNumber, clinicId, fullName = null } = req.body ?? {};

    if (!contactNumber || !clinicId) {
      return res.status(422).json({ error: "contactNumber and clinicId are required" });
    }

    const { data: existing, error: lookupError } = await supabaseClient
      .from("Patient")
      .select("*")
      .eq("contactNumber", contactNumber)
      .eq("clinicId", clinicId)
      .maybeSingle();

    if (lookupError) {
      req.log.error({ err: lookupError, contactNumber, clinicId }, "Patient lookup failed");
      return res.status(500).json({ error: "Internal server error" });
    }

    if (existing) {
      return res.json({
        patientId: existing.id,
        fullName: existing.fullName ?? null,
        contactNumber: existing.contactNumber,
        age: existing.age ?? null,
        gender: existing.gender ?? null,
        clinicId: existing.clinicId,
        isNew: false,
      });
    }

    const id = `pat_${crypto.randomUUID()}`;
    const { data: created, error: createError } = await supabaseClient
      .from("Patient")
      .insert({
        id,
        clinicId,
        fullName,
        contactNumber,
        createdAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) {
      req.log.error({ err: createError, contactNumber, clinicId }, "Patient creation failed");
      return res.status(500).json({ error: "Internal server error" });
    }

    return res.status(201).json({
      patientId: created.id,
      fullName: created.fullName ?? null,
      contactNumber: created.contactNumber,
      age: created.age ?? null,
      gender: created.gender ?? null,
      clinicId: created.clinicId,
      isNew: true,
    });
  });

  // POST /tools/patients/update
  // PATCH semantics — only updates fields present in the payload. Null-fills omitted fields.
  router.post("/patients/update", async (req, res) => {
    const { patientId, fullName, age, gender } = req.body ?? {};

    if (!patientId) {
      return res.status(422).json({ error: "patientId is required" });
    }

    const patch = {};
    if (fullName !== undefined) patch.fullName = fullName ?? null;
    if (age !== undefined) patch.age = age ?? null;
    if (gender !== undefined) patch.gender = gender ?? null;

    // No fields to patch — just return current state
    if (Object.keys(patch).length === 0) {
      const { data, error } = await supabaseClient
        .from("Patient")
        .select("id, fullName, age, gender, clinicId, contactNumber")
        .eq("id", patientId)
        .maybeSingle();

      if (error) {
        req.log.error({ err: error, patientId }, "Patient fetch failed");
        return res.status(500).json({ error: "Internal server error" });
      }

      if (!data) return res.status(404).json({ error: "Patient not found" });

      return res.json({
        patientId: data.id,
        fullName: data.fullName ?? null,
        age: data.age ?? null,
        gender: data.gender ?? null,
        contactNumber: data.contactNumber,
        clinicId: data.clinicId,
      });
    }

    const { data, error } = await supabaseClient
      .from("Patient")
      .update(patch)
      .eq("id", patientId)
      .select("id, fullName, age, gender, clinicId, contactNumber")
      .maybeSingle();

    if (error) {
      req.log.error({ err: error, patientId }, "Patient update failed");
      return res.status(500).json({ error: "Internal server error" });
    }

    if (!data) return res.status(404).json({ error: "Patient not found" });

    return res.json({
      patientId: data.id,
      fullName: data.fullName ?? null,
      age: data.age ?? null,
      gender: data.gender ?? null,
      contactNumber: data.contactNumber,
      clinicId: data.clinicId,
    });
  });

  // POST /tools/doctors/list
  // Returns all active doctors for a clinic.
  router.post("/doctors/list", async (req, res) => {
    const { clinicId } = req.body ?? {};

    if (!clinicId) {
      return res.status(422).json({ error: "clinicId is required" });
    }

    const { data, error } = await supabaseClient
      .from("Doctor")
      .select("id, fullName, specialty, qualification, languages, feeInr")
      .eq("clinicId", clinicId)
      .eq("isActive", true);

    if (error) {
      req.log.error({ err: error, clinicId }, "Doctor list failed");
      return res.status(500).json({ error: "Internal server error" });
    }

    return res.json({
      doctors: (data ?? []).map((d) => ({
        doctorId: d.id,
        fullName: d.fullName,
        specialty: d.specialty ?? null,
        qualification: d.qualification ?? null,
        languages: d.languages ?? null,
        feeInr: d.feeInr,
      })),
    });
  });

  // POST /tools/appointments/book
  // Creates an appointment. Only patientId, clinicId, doctorId are required;
  // all clinical fields default to null so the call never fails mid-collection.
  router.post("/appointments/book", async (req, res) => {
    const {
      patientId,
      clinicId,
      doctorId,
      bookerRelation = null,
      proxyName = null,
      symptoms = null,
      notes = null,
      timeslot = null,
      durationMinutes = null,
    } = req.body ?? {};

    if (!patientId || !clinicId || !doctorId) {
      return res.status(422).json({ error: "patientId, clinicId and doctorId are required" });
    }

    const id = `apt_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const { data, error } = await supabaseClient
      .from("Appointment")
      .insert({
        id,
        clinicId,
        patientId,
        doctorId,
        bookerRelation,
        proxyName,
        symptoms,
        notes,
        timeslot,
        durationMinutes,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .select()
      .single();

    if (error) {
      req.log.error({ err: error, patientId, clinicId, doctorId }, "Appointment creation failed");
      return res.status(500).json({ error: "Internal server error" });
    }

    return res.status(201).json({
      appointmentId: data.id,
      patientId: data.patientId,
      clinicId: data.clinicId,
      doctorId: data.doctorId,
      bookerRelation: data.bookerRelation ?? null,
      symptoms: data.symptoms ?? null,
      timeslot: data.timeslot ?? null,
      status: data.status,
      formUrl: `/${data.clinicId}/${data.id}`,
    });
  });

  // POST /tools/appointments/form
  // Returns the intake form URL for an existing appointment.
  router.post("/appointments/form", async (req, res) => {
    const { appointmentId } = req.body ?? {};

    if (!appointmentId) {
      return res.status(422).json({ error: "appointmentId is required" });
    }

    const { data, error } = await supabaseClient
      .from("Appointment")
      .select("id, clinicId")
      .eq("id", appointmentId)
      .maybeSingle();

    if (error) {
      req.log.error({ err: error, appointmentId }, "Appointment form lookup failed");
      return res.status(500).json({ error: "Internal server error" });
    }

    if (!data) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    return res.json({
      appointmentId: data.id,
      clinicId: data.clinicId,
      formUrl: `/${data.clinicId}/${data.id}`,
    });
  });

  return router;
}

module.exports = { createToolsRouter };
