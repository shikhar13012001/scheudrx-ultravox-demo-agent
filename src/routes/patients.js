const { Router } = require("express");
const crypto = require("node:crypto");
const { resolveCallCtx, formatPatient } = require("./tool-helpers");

function createPatientsRouter(supabaseClient, callStore) {
  const router = Router();

  router.post("/identify", async (req, res) => {
    req.log.info({ body: req.body }, "[tool] identify_patient invoked");
    const { ultravoxCallId } = req.body ?? {};

    const ctx = resolveCallCtx(callStore, ultravoxCallId, req.log);
    if (!ctx?.clinicId || !ctx?.phoneNumber) {
      return res.status(422).json({ error: "Unable to resolve clinic or caller from call context" });
    }
    const { clinicId, phoneNumber: contactNumber } = ctx;

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
      if (ultravoxCallId) callStore?.upsert(ultravoxCallId, { patientId: existing.id });
      return res.json(formatPatient(existing, false));
    }

    const { data: created, error: createError } = await supabaseClient
      .from("Patient")
      .insert({
        id: `pat_${crypto.randomUUID()}`,
        clinicId,
        fullName: null,
        contactNumber,
        createdAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) {
      req.log.error({ err: createError, contactNumber, clinicId }, "Patient creation failed");
      return res.status(500).json({ error: "Internal server error" });
    }

    if (ultravoxCallId) callStore?.upsert(ultravoxCallId, { patientId: created.id });
    return res.status(201).json(formatPatient(created, true));
  });

  router.post("/update", async (req, res) => {
    req.log.info({ body: req.body }, "[tool] update_patient invoked");
    const { ultravoxCallId, fullName, age, gender } = req.body ?? {};

    const ctx = resolveCallCtx(callStore, ultravoxCallId, req.log);
    const patientId = ctx?.patientId ?? null;

    if (!patientId) {
      return res.status(422).json({ error: "Unable to resolve patientId — call identify_patient first" });
    }

    const patch = {};
    if (fullName !== undefined) patch.fullName = fullName ?? null;
    if (age !== undefined) patch.age = age ?? null;
    if (gender !== undefined) patch.gender = gender ?? null;

    const query = Object.keys(patch).length === 0
      ? supabaseClient.from("Patient").select("id, fullName, age, gender, clinicId, contactNumber").eq("id", patientId)
      : supabaseClient.from("Patient").update(patch).eq("id", patientId).select("id, fullName, age, gender, clinicId, contactNumber");

    const { data, error } = await query.maybeSingle();

    if (error) {
      req.log.error({ err: error, patientId }, "Patient update failed");
      return res.status(500).json({ error: "Internal server error" });
    }
    if (!data) return res.status(404).json({ error: "Patient not found" });

    return res.json(formatPatient(data, false));
  });

  return router;
}

module.exports = { createPatientsRouter };
