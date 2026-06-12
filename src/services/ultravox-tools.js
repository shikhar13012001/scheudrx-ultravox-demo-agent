// Builders for Ultravox temporaryTool definitions.
// Each tool function returns a single { temporaryTool: ... } entry for the toolOverrides.add array.

function authHeaders(apiKey) {
  return [
    { name: "Authorization", location: "PARAMETER_LOCATION_HEADER", value: `Bearer ${apiKey}` },
    { name: "Content-Type", location: "PARAMETER_LOCATION_HEADER", value: "application/json" },
  ];
}

function autoCallIdParam() {
  return [
    { name: "ultravoxCallId", location: "PARAMETER_LOCATION_BODY", knownValue: "KNOWN_PARAM_CALL_ID" },
  ];
}

function bodyParam(name, schema, required = false) {
  return { name, location: "PARAMETER_LOCATION_BODY", schema, required };
}

function httpPost(base, path) {
  return { baseUrlPattern: `${base}${path}`, httpMethod: "POST" };
}

// ─── Individual tool builders ───────────────────────────────────────────────

function identifyPatientTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "identify_patient",
      description:
        "Look up the calling patient's record at the very start of every call, before saying anything else. " +
        "No parameters needed — the server already knows the caller's phone number and which clinic they dialled. " +
        "Returns isNew, fullName, age, and gender. " +
        "Use isNew to personalise the greeting; use any returned profile data instead of asking for it again. " +
        "This must be the first tool called on every call — do not skip it.",
      staticParameters: headers,
      automaticParameters: auto,
      http: httpPost(base, "/patients/identify"),
    },
  };
}

function updatePatientTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "update_patient",
      description:
        "Persist demographic details the patient shares or corrects during the conversation. " +
        "Call this as soon as the patient confirms their name, age, or gender — do not wait until the end of the call. " +
        "Only pass fields the patient has explicitly stated; omit anything unknown or unconfirmed. " +
        "May be called multiple times if the patient corrects information.",
      dynamicParameters: [
        bodyParam("fullName", { type: "string", description: "Patient's full name exactly as spoken, e.g. 'Rahul Sharma'" }),
        bodyParam("age", { type: "integer", description: "Patient's age in years as a whole number" }),
        bodyParam("gender", { type: "string", enum: ["male", "female", "other"], description: "Patient's gender — must be one of: male, female, other" }),
      ],
      staticParameters: headers,
      automaticParameters: auto,
      http: httpPost(base, "/patients/update"),
    },
  };
}

function listDoctorsTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "list_doctors",
      description:
        "Fetch all active doctors at this clinic. " +
        "Call this when the patient asks who is available or needs help choosing a doctor. " +
        "Returns fullName, specialty, qualification, languages, and feeInr for each doctor. " +
        "After the patient confirms a doctor, call select_doctor — never pass doctorId manually.",
      staticParameters:    headers,
      automaticParameters: auto,
      http: httpPost(base, "/doctors/list"),
    },
  };
}

function selectDoctorTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "select_doctor",
      description:
        "Resolve a doctor by spoken name and store their ID for the rest of this call. " +
        "Call this as soon as the patient names or confirms a doctor — before checking slots or booking. " +
        "Pass the name exactly as spoken; partial names and 'Dr. X' format both work. " +
        "After this call, do NOT pass doctorId to any other tool — the server resolves it from context. " +
        "If the name does not match, the response includes availableDoctors to help the patient choose.",
      dynamicParameters: [
        bodyParam("doctorName", { type: "string", description: "Doctor's name as spoken, e.g. 'Dr. Sharma' or 'Priya'" }, true),
      ],
      staticParameters:    headers,
      automaticParameters: auto,
      http: httpPost(base, "/doctors/select"),
    },
  };
}

function bookAppointmentTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "book_appointment",
      description:
        "Create a calendar-blocked appointment once the patient confirms a specific slot from get_doctor_available_slots. " +
        "Requires select_doctor to have been called first — doctor is resolved from call context automatically. " +
        "Only call this after the patient confirms a specific slot — never invent or guess a slot time. " +
        "patientId and clinicId are resolved server-side; never ask the caller for them. " +
        "If the response is SLOT_NOT_AVAILABLE, the details.alternatives array contains fresh options — present those to the patient. " +
        "After booking, confirm the date and time naturally — never read out the ISO string. " +
        "Do NOT mention or read out the form URL — the form is handled separately.",
      dynamicParameters: [
        bodyParam("slotStart", { type: "string", description: "Exact slot start time in ISO 8601 from get_doctor_available_slots, e.g. '2026-06-20T10:00:00+05:30'" }, true),
        bodyParam("slotEnd",   { type: "string", description: "Slot end time in ISO 8601 — omit to use the default duration" }),
        bodyParam("reason",    { type: "string", description: "Brief reason for the visit, e.g. 'fever and sore throat'" }),
        bodyParam("appointmentType", { type: "string", enum: ["consultation", "follow-up", "emergency"], description: "Type of appointment" }),
      ],
      staticParameters: headers,
      automaticParameters: auto,
      http: httpPost(base, "/appointments/book"),
    },
  };
}

function sendFormTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "send_form",
      description:
        "Send the patient intake form to the caller's phone number. " +
        "Call this ONLY if the caller explicitly asks for the form to be sent " +
        "(e.g. 'send me the link', 'WhatsApp me the form', 'can you send the form to my number'). " +
        "Do not call this automatically after booking — only on explicit request. " +
        "No parameters needed — the appointment and phone number are already known from this call.",
      staticParameters: headers,
      automaticParameters: auto,
      http: httpPost(base, "/appointments/send-form"),
    },
  };
}

// ─── Calendar tools ──────────────────────────────────────────────────────────

function getAvailableSlotsTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "get_doctor_available_slots",
      description:
        "Fetch available appointment slots for the selected doctor. " +
        "Requires select_doctor to have been called first — the doctor is resolved from call context automatically. " +
        "Optionally provide a single date or a date range. " +
        "If the patient names a day or week, pass it as date or dateRange. " +
        "Never guess or invent slot times — only offer times returned by this tool. " +
        "If the response is NO_SLOTS_AVAILABLE, tell the patient and suggest a different date range.",
      dynamicParameters: [
        bodyParam("date",      { type: "string", description: "Single date in YYYY-MM-DD format, e.g. '2026-06-20'" }),
        bodyParam("dateRange", {
          type:        "object",
          description: "Date range to search, e.g. { start: '2026-06-20', end: '2026-06-27' }",
          properties:  { start: { type: "string" }, end: { type: "string" } },
        }),
        bodyParam("timezone", { type: "string", description: "IANA timezone for the response, e.g. 'Asia/Kolkata'" }),
      ],
      staticParameters:    headers,
      automaticParameters: auto,
      http: httpPost(base, "/calendar/slots"),
    },
  };
}

function rescheduleAppointmentTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "reschedule_appointment",
      description:
        "Reschedule an existing appointment to a new time. " +
        "First call get_doctor_available_slots to find the new available slot. " +
        "Pass the appointmentId from the current call context (or ask the patient to confirm it). " +
        "Pass newStart as the exact slot start time the patient has chosen. " +
        "Rescheduling may be blocked if it is within the clinic's reschedule cutoff window. " +
        "After rescheduling, confirm the new date and time naturally.",
      dynamicParameters: [
        bodyParam("appointmentId", { type: "string", description: "ID of the appointment to reschedule — from the current call context or stated by the patient" }),
        bodyParam("newStart",      { type: "string", description: "New slot start time in ISO 8601, e.g. '2026-06-21T11:00:00+05:30'" }, true),
        bodyParam("newEnd",        { type: "string", description: "New slot end time in ISO 8601 — omit to use the default duration" }),
        bodyParam("reason",        { type: "string", description: "Reason for rescheduling, e.g. 'patient requested a later time'" }),
      ],
      staticParameters:    headers,
      automaticParameters: auto,
      http: httpPost(base, "/calendar/reschedule"),
    },
  };
}

function cancelAppointmentTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "cancel_appointment",
      description:
        "Cancel an existing appointment. " +
        "Confirm with the patient before calling this tool — cancellation may be irreversible. " +
        "The appointmentId is resolved automatically from the current call if the patient booked in this call. " +
        "Otherwise ask the patient for the appointment reference. " +
        "Cancellation may be blocked if it is within the clinic's cancellation cutoff window. " +
        "After cancelling, confirm to the patient that the appointment has been cancelled.",
      dynamicParameters: [
        bodyParam("appointmentId", { type: "string", description: "ID of the appointment to cancel — from the current call context or stated by the patient" }),
        bodyParam("reason",        { type: "string", description: "Reason for cancellation, e.g. 'patient is unavailable'" }),
      ],
      staticParameters:    headers,
      automaticParameters: auto,
      http: httpPost(base, "/calendar/cancel"),
    },
  };
}

function debugEchoTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "debug_echo",
      description:
        "Development-only diagnostic tool. " +
        "Echoes back every header and body field the server received. " +
        "Use during testing to confirm auth headers and ultravoxCallId are wired correctly. " +
        "Never call this during a real patient interaction.",
      dynamicParameters: [
        bodyParam("testMessage", { type: "string", description: "Any string to include in the echo response" }),
      ],
      staticParameters: headers,
      automaticParameters: auto,
      http: httpPost(base, "/debug/echo"),
    },
  };
}

// ─── Public assembler ────────────────────────────────────────────────────────

function buildToolOverrides(baseUrl, apiKey) {
  const headers = authHeaders(apiKey);
  const auto = autoCallIdParam();

  return {
    removeAll: true,
    add: [
      identifyPatientTool(baseUrl, headers, auto),
      updatePatientTool(baseUrl, headers, auto),
      listDoctorsTool(baseUrl, headers, auto),
      selectDoctorTool(baseUrl, headers, auto),
      bookAppointmentTool(baseUrl, headers, auto),
      sendFormTool(baseUrl, headers, auto),
      // Calendar-integrated tools (require NETTU_BASE_URL + NETTU_API_KEY).
      getAvailableSlotsTool(baseUrl, headers, auto),
      rescheduleAppointmentTool(baseUrl, headers, auto),
      cancelAppointmentTool(baseUrl, headers, auto),
      debugEchoTool(baseUrl, headers, auto),
    ],
  };
}

module.exports = { buildToolOverrides };
