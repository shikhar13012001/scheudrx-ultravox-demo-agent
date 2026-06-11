const { Router } = require("express");
const { createPatientsRouter } = require("./patients");
const { createDoctorsRouter } = require("./doctors");
const { createAppointmentsRouter } = require("./appointments");

function createToolsRouter(supabaseClient, callStore) {
  const router = Router();

  router.use("/patients", createPatientsRouter(supabaseClient, callStore));
  router.use("/doctors", createDoctorsRouter(supabaseClient, callStore));
  router.use("/appointments", createAppointmentsRouter(supabaseClient, callStore));

  return router;
}

module.exports = { createToolsRouter };
