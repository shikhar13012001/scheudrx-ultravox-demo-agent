const { Router } = require("express");
const { createPatientsRouter }      = require("./patients");
const { createDoctorsRouter }       = require("./doctors");
const { createAppointmentsRouter }  = require("./appointments");
const { createCalendarToolsRouter } = require("./calendar-tools");

function createToolsRouter(supabaseClient, callStore, nettuClient) {
  const router = Router();

  router.use("/patients",     createPatientsRouter(supabaseClient, callStore));
  router.use("/doctors",      createDoctorsRouter(supabaseClient, callStore));
  router.use("/appointments", createAppointmentsRouter(supabaseClient, callStore));

  // Calendar-integrated tools — only mounted when nettuClient is available.
  if (nettuClient) {
    router.use("/calendar", createCalendarToolsRouter(nettuClient, supabaseClient, callStore));
  }

  return router;
}

module.exports = { createToolsRouter };
