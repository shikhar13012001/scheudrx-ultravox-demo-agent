const { Router } = require("express");
const crypto = require("node:crypto");
const { resolveCallCtx, formUrl } = require("./tool-helpers");

function createAppointmentsRouter(supabaseClient, callStore) {
  const router = Router();

  router.post("/book", async (req, res) => {
    req.log.info({ body: req.body }, "[tool] book_appointment invoked");
    const { ultravoxCallId, doctorId, symptoms = null, timeslot = null } = req.body ?? {};

    if (!doctorId) {
      return res.status(422).json({ error: "doctorId is required" });
    }

    const ctx = resolveCallCtx(callStore, ultravoxCallId, req.log);
    const clinicId = ctx?.clinicId ?? null;
    let patientId = ctx?.patientId ?? null;

    if (!clinicId) {
      return res.status(422).json({ error: "clinicId could not be resolved — the clinic phone number may not be registered" });
    }

    // If identify_patient was skipped, fall back to a Supabase lookup by phone number.
    if (!patientId && ctx?.phoneNumber) {
      req.log.warn({ ultravoxCallId, phoneNumber: ctx.phoneNumber }, "patientId missing — falling back to Supabase lookup");
      const { data: patient } = await supabaseClient
        .from("Patient")
        .select("id")
        .eq("contactNumber", ctx.phoneNumber)
        .eq("clinicId", clinicId)
        .maybeSingle();
      patientId = patient?.id ?? null;
      if (patientId && ultravoxCallId) callStore?.upsert(ultravoxCallId, { patientId });
    }

    if (!patientId) {
      return res.status(422).json({ error: "patientId could not be resolved — call identify_patient first" });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabaseClient
      .from("Appointment")
      .insert({
        id: `apt_${crypto.randomUUID()}`,
        clinicId,
        patientId,
        doctorId,
        symptoms,
        timeslot,
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

    if (ultravoxCallId) {
      callStore?.upsert(ultravoxCallId, {
        appointment: {
          appointmentId: data.id,
          doctorId: data.doctorId,
          timeslot: data.timeslot ?? null,
          status: data.status,
          formUrl: formUrl(data.clinicId, data.id),
        },
      });
    }

    return res.status(201).json({
      appointmentId: data.id,
      patientId: data.patientId,
      clinicId: data.clinicId,
      doctorId: data.doctorId,
      symptoms: data.symptoms ?? null,
      timeslot: data.timeslot ?? null,
      status: data.status,
      formUrl: formUrl(data.clinicId, data.id),
    });
  });

  router.post("/form", async (req, res) => {
    req.log.info({ body: req.body }, "[tool] get_appointment_form invoked");
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

    if (!data) return res.status(404).json({ error: "Appointment not found" });

    return res.json({
      appointmentId: data.id,
      clinicId: data.clinicId,
      formUrl: formUrl(data.clinicId, data.id),
    });
  });

  return router;
}

module.exports = { createAppointmentsRouter };
