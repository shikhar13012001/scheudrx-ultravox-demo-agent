const { Router }              = require("express");
const crypto                  = require("node:crypto");
const { resolveCallCtx, formUrl } = require("./tool-helpers");

function createAppointmentsRouter(supabaseClient, callStore) {
  const router = Router();

  router.post("/book", async (req, res) => {
    req.log.info({ body: req.body }, "[tool] book_appointment invoked");
    const { ultravoxCallId, doctorId: bodyDoctorId, symptoms = null, timeslot = null } = req.body ?? {};

    const ctx = resolveCallCtx(callStore, ultravoxCallId, req.log);
    const clinicId = ctx?.clinicId ?? null;

    // Resolve doctorId from body first, then fall back to call context (set by select_doctor).
    const doctorId = bodyDoctorId ?? ctx?.doctorId ?? null;

    if (!clinicId) {
      return res.status(422).json({ error: "clinicId could not be resolved — the clinic phone number may not be registered" });
    }
    if (!doctorId) {
      return res.status(422).json({ error: "doctorId is required — call select_doctor first or pass it explicitly" });
    }

    // Resolve patientId from context; fall back to a phone lookup if identify_patient was skipped.
    let patientId = ctx?.patientId ?? null;
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
        id:        `apt_${crypto.randomUUID()}`,
        clinicId,
        patientId,
        doctorId,
        symptoms,
        timeslot,
        status:    "pending",
        createdAt: now,
        updatedAt: now,
      })
      .select()
      .single();

    if (error) {
      req.log.error({ err: error, patientId, clinicId, doctorId }, "Appointment creation failed");
      return res.status(500).json({ error: "Internal server error" });
    }

    const appointmentFormUrl = formUrl(data.clinicId, data.id);

    if (ultravoxCallId) {
      callStore?.upsert(ultravoxCallId, {
        appointment: {
          appointmentId: data.id,
          doctorId:      data.doctorId,
          timeslot:      data.timeslot ?? null,
          status:        data.status,
          formUrl:       appointmentFormUrl,
        },
      });
    }

    req.log.info(
      { appointmentId: data.id, phoneNumber: ctx?.phoneNumber ?? null, formUrl: appointmentFormUrl },
      "[form] appointment booked — form URL logged for delivery",
    );

    return res.status(201).json({
      appointmentId: data.id,
      patientId:     data.patientId,
      clinicId:      data.clinicId,
      doctorId:      data.doctorId,
      symptoms:      data.symptoms ?? null,
      timeslot:      data.timeslot ?? null,
      status:        data.status,
    });
  });

  // POST /tools/appointments/send-form
  // Placeholder for SMS delivery — logs the form URL until messaging is configured.
  router.post("/send-form", async (req, res) => {
    req.log.info({ body: req.body }, "[tool] send_form invoked");
    const { ultravoxCallId } = req.body ?? {};

    const ctx                = resolveCallCtx(callStore, ultravoxCallId, req.log);
    const appointmentFormUrl = ctx?.appointment?.formUrl ?? null;
    const phoneNumber        = ctx?.phoneNumber ?? null;

    if (!appointmentFormUrl) {
      return res.status(422).json({ error: "No booked appointment found in this call — book an appointment first" });
    }

    req.log.info(
      { phoneNumber, formUrl: appointmentFormUrl },
      "[form] SMS not configured — form URL logged for manual delivery",
    );

    return res.json({
      delivered: false,
      note:      "Form URL has been logged. SMS delivery will be available once messaging is configured.",
      formUrl:   appointmentFormUrl,
    });
  });

  return router;
}

module.exports = { createAppointmentsRouter };
