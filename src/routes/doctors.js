const { Router } = require("express");
const { resolveCallCtx } = require("./tool-helpers");

function createDoctorsRouter(supabaseClient, callStore) {
  const router = Router();

  router.post("/list", async (req, res) => {
    req.log.info({ body: req.body }, "[tool] list_doctors invoked");
    const { ultravoxCallId } = req.body ?? {};

    const ctx = resolveCallCtx(callStore, ultravoxCallId, req.log);
    const clinicId = ctx?.clinicId ?? null;

    if (!clinicId) {
      return res.status(422).json({ error: "Unable to resolve clinicId from call context" });
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

  return router;
}

module.exports = { createDoctorsRouter };
