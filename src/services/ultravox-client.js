const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

class UltravoxClient {
  constructor({
    config,
    fetchImpl = globalThis.fetch,
    logger,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {}) {
    if (!config) {
      throw new Error("UltravoxClient requires config");
    }

    if (!fetchImpl) {
      throw new Error("A fetch implementation is required for UltravoxClient");
    }

    this.config = config;
    this.fetch = fetchImpl;
    this.logger = logger;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async createInboundCall(metadata = {}) {
    const webhookCallback = {
      url: `${this.config.PUBLIC_BASE_URL}/webhooks/ultravox`,
      secrets: [this.config.ULTRAVOX_WEBHOOK_SECRET],
    };

    // Ultravox metadata values must be strings — strip nulls/undefined before sending.
    const rawMetadata = {
      ...metadata,
      toolsBaseUrl: `${this.config.PUBLIC_BASE_URL}/tools`,
      toolsApiKey: this.config.TOOLS_API_KEY,
    };
    const enrichedMetadata = Object.fromEntries(
      Object.entries(rawMetadata).filter(([, v]) => v != null),
    );

    const body = {
      medium: { twilio: {} },
      firstSpeakerSettings: { agent: {} },
      recordingEnabled: this.config.ULTRAVOX_RECORDING_ENABLED,
      joinTimeout: this.config.ULTRAVOX_JOIN_TIMEOUT,
      maxDuration: this.config.ULTRAVOX_MAX_DURATION,
      metadata: enrichedMetadata,
      toolOverrides: { add: this.#buildSelectedTools(enrichedMetadata) },
      callbacks: {
        joined: webhookCallback,
        ended: webhookCallback,
        billed: webhookCallback,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await this.fetch(
        `${this.config.ULTRAVOX_API_BASE_URL}/agents/${this.config.ULTRAVOX_AGENT_ID}/calls`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.config.ULTRAVOX_API_KEY,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const error = new Error("Ultravox call creation failed");
        error.statusCode = response.status;
        error.responseBody = data;
        throw error;
      }

      return this.#parseCreateCallResponse(data);
    } finally {
      clearTimeout(timeout);
    }
  }

  #buildSelectedTools(_metadata = {}) {
    const base = `${this.config.PUBLIC_BASE_URL}/tools`;
    const auth = `Bearer ${this.config.TOOLS_API_KEY}`;

    // All clinic/patient context is resolved server-side from the call store keyed by ultravoxCallId.
    // Tools only need auth headers; no IDs are injected as static parameters.
    const authHeaders = [
      { name: "Authorization", location: "PARAMETER_LOCATION_HEADER", value: auth },
      { name: "Content-Type", location: "PARAMETER_LOCATION_HEADER", value: "application/json" },
    ];

    // Ultravox auto-injects the call ID at invocation time.
    const autoParams = [
      { name: "ultravoxCallId", location: "PARAMETER_LOCATION_BODY", knownValue: "KNOWN_PARAM_CALL_ID" },
    ];

    return [
      {
        temporaryTool: {
          modelToolName: "identify_patient",
          description:
            "Look up the calling patient's record at the very start of every call, before saying anything else. " +
            "You do not need to provide any parameters — the server already knows the caller's phone number and which clinic they dialled. " +
            "The response tells you whether this is a returning patient (isNew: false) or a first-time caller (isNew: true), " +
            "and returns their stored fullName, age, and gender if available. " +
            "Use isNew to personalise your greeting: welcome back a returning patient by name, " +
            "or introduce the clinic and collect basic details for a new one. " +
            "This tool must be the first tool called on every call — do not skip it.",
          staticParameters: authHeaders,
          automaticParameters: autoParams,
          http: { baseUrlPattern: `${base}/patients/identify`, httpMethod: "POST" },
        },
      },
      {
        temporaryTool: {
          modelToolName: "update_patient",
          description:
            "Persist demographic details the patient shares or corrects during the conversation. " +
            "Call this as soon as the patient confirms or provides their full name, age, or gender — do not wait until the end of the call. " +
            "Only include fields the patient has explicitly stated; omit any field that is still unknown or unconfirmed. " +
            "You may call this tool multiple times if the patient corrects information later in the call. " +
            "Returns the updated patient record so you can confirm the saved values.",
          dynamicParameters: [
            {
              name: "fullName",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Patient's full name exactly as spoken, e.g. 'Rahul Sharma'" },
              required: false,
            },
            {
              name: "age",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "integer", description: "Patient's age in years as a whole number" },
              required: false,
            },
            {
              name: "gender",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", enum: ["male", "female", "other"], description: "Patient's gender — must be one of: male, female, other" },
              required: false,
            },
          ],
          staticParameters: authHeaders,
          automaticParameters: autoParams,
          http: { baseUrlPattern: `${base}/patients/update`, httpMethod: "POST" },
        },
      },
      {
        temporaryTool: {
          modelToolName: "list_doctors",
          description:
            "Fetch the list of doctors currently available at this clinic. " +
            "Call this whenever the patient asks who is available, wants to know their options, or is ready to choose a doctor. " +
            "Each doctor entry includes their name, specialty, qualification, languages spoken, and consultation fee in INR. " +
            "Present the options clearly and naturally — for example, group by specialty if there are many, " +
            "or highlight the fee and languages if the patient asked about those. " +
            "The doctorId from this response is required by book_appointment.",
          staticParameters: authHeaders,
          automaticParameters: autoParams,
          http: { baseUrlPattern: `${base}/doctors/list`, httpMethod: "POST" },
        },
      },
      {
        temporaryTool: {
          modelToolName: "book_appointment",
          description:
            "Create a new appointment once the patient has confirmed their identity and chosen a doctor. " +
            "doctorId is required and must come from the list_doctors response — never guess or make up an ID. " +
            "All other fields are optional: collect as many as the patient is willing to share before booking, " +
            "but do not block the booking if they are not provided — the appointment will succeed without them. " +
            "If the patient is booking on behalf of someone else, set bookerRelation (e.g. 'parent', 'spouse') and proxyName to the patient's actual name. " +
            "On success the response includes appointmentId, status ('pending'), and a formUrl — " +
            "always read the formUrl to the patient at the end of the call and ask them to complete it before their visit.",
          dynamicParameters: [
            {
              name: "doctorId",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Unique ID of the doctor the patient selected, as returned by list_doctors" },
              required: true,
            },
            {
              name: "symptoms",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Patient's main symptom or reason for the visit in their own words, e.g. 'fever and headache for two days'" },
              required: false,
            },
            {
              name: "timeslot",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Preferred appointment date and time in ISO 8601 format, e.g. '2026-06-15T10:30:00'" },
              required: false,
            },
            {
              name: "durationMinutes",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "integer", description: "Requested appointment duration in minutes, e.g. 15 or 30" },
              required: false,
            },
            {
              name: "bookerRelation",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Caller's relationship to the patient when booking on someone else's behalf, e.g. 'parent', 'spouse', 'sibling'" },
              required: false,
            },
            {
              name: "proxyName",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Full name of the person the caller is booking for, when booking on behalf of someone else" },
              required: false,
            },
            {
              name: "notes",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Any additional context for the clinic, e.g. accessibility needs or follow-up details" },
              required: false,
            },
          ],
          staticParameters: authHeaders,
          automaticParameters: autoParams,
          http: { baseUrlPattern: `${base}/appointments/book`, httpMethod: "POST" },
        },
      },
      {
        temporaryTool: {
          modelToolName: "get_appointment_form",
          description:
            "Retrieve the patient intake form URL for an appointment that has already been booked. " +
            "Call this immediately after book_appointment if you need to re-fetch the formUrl, " +
            "for example if you want to send it by SMS or confirm it with the patient. " +
            "appointmentId is returned by book_appointment. " +
            "Always share the formUrl with the patient before ending the call and ask them to fill it in before their visit.",
          dynamicParameters: [
            {
              name: "appointmentId",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Appointment ID as returned by book_appointment, e.g. 'apt_...' " },
              required: true,
            },
          ],
          staticParameters: authHeaders,
          automaticParameters: autoParams,
          http: { baseUrlPattern: `${base}/appointments/form`, httpMethod: "POST" },
        },
      },
      {
        temporaryTool: {
          modelToolName: "debug_echo",
          description:
            "Development-only diagnostic tool. " +
            "Echoes back every header and body field exactly as the server received them. " +
            "Use this during testing to confirm that auth headers and the auto-injected ultravoxCallId are arriving correctly. " +
            "Do not call this tool during a real patient interaction.",
          dynamicParameters: [
            {
              name: "testMessage",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Any string you want included in the echo response" },
              required: false,
            },
          ],
          staticParameters: authHeaders,
          automaticParameters: autoParams,
          http: { baseUrlPattern: `${base}/debug/echo`, httpMethod: "POST" },
        },
      },
    ];
  }

  #parseCreateCallResponse(data) {
    if (!data?.callId || !data?.joinUrl) {
      const error = new Error("Ultravox call creation response was missing callId or joinUrl");
      error.responseBody = data;
      throw error;
    }

    return data;
  }
}

module.exports = { UltravoxClient };
