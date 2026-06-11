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
        "Call this before presenting options to the caller. " +
        "Returns doctorId, fullName, specialty, qualification, languages, and feeInr for each doctor. " +
        "The doctorId from this response is required by book_appointment — never guess or invent one.",
      staticParameters: headers,
      automaticParameters: auto,
      http: httpPost(base, "/doctors/list"),
    },
  };
}

function bookAppointmentTool(base, headers, auto) {
  return {
    temporaryTool: {
      modelToolName: "book_appointment",
      description:
        "Create an appointment once the patient has confirmed a doctor. " +
        "Only collect doctorId, timeslot, and symptoms — nothing else. " +
        "timeslot and symptoms are optional — book immediately if the patient skips them. " +
        "patientId and clinicId are resolved server-side; never ask the caller for them. " +
        "After booking, say the date and time naturally (e.g. 'Thursday the 12th at 6 in the evening') — never read out the ISO string. " +
        "Do NOT mention or read out the form URL — the form is handled separately.",
      dynamicParameters: [
        bodyParam("doctorId", { type: "string", description: "Doctor's unique ID from list_doctors — never guess this value" }, true),
        bodyParam("timeslot", { type: "string", description: "Preferred date and time in ISO 8601, e.g. '2026-06-15T10:30:00+05:30'" }),
        bodyParam("symptoms", { type: "string", description: "Brief description of the patient's symptoms or reason for visit" }),
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
      bookAppointmentTool(baseUrl, headers, auto),
      sendFormTool(baseUrl, headers, auto),
      debugEchoTool(baseUrl, headers, auto),
    ],
  };
}

module.exports = { buildToolOverrides };
