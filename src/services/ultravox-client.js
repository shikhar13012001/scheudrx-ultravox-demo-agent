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

    const enrichedMetadata = {
      ...metadata,
      toolsBaseUrl: `${this.config.PUBLIC_BASE_URL}/tools`,
      toolsApiKey: this.config.TOOLS_API_KEY,
    };

    const body = {
      medium: { twilio: {} },
      firstSpeakerSettings: { agent: {} },
      recordingEnabled: this.config.ULTRAVOX_RECORDING_ENABLED,
      joinTimeout: this.config.ULTRAVOX_JOIN_TIMEOUT,
      maxDuration: this.config.ULTRAVOX_MAX_DURATION,
      metadata: enrichedMetadata,
      selectedTools: this.#buildSelectedTools(),
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

  #buildSelectedTools() {
    const base = `${this.config.PUBLIC_BASE_URL}/tools`;
    const auth = `Bearer ${this.config.TOOLS_API_KEY}`;
    const staticParameters = [
      { name: "Authorization", location: "PARAMETER_LOCATION_HEADER", value: auth },
      { name: "Content-Type", location: "PARAMETER_LOCATION_HEADER", value: "application/json" },
    ];

    return [
      {
        temporaryTool: {
          modelToolName: "identify_patient",
          description:
            "Look up or create a patient record by phone number and clinic. " +
            "Call this at the start of every conversation to confirm who is calling and retrieve their profile (name, age, gender). " +
            "Also call if the patient says they are calling on behalf of someone else or if patientId is unavailable in your context. " +
            "clinicId is available in your call context. " +
            "Returns patientId, fullName, age, gender, and isNew (true if first-time caller).",
          dynamicParameters: [
            {
              name: "contactNumber",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Caller's phone number in E.164 format, e.g. +911234567890" },
              required: true,
            },
            {
              name: "clinicId",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Clinic identifier from your call context" },
              required: true,
            },
            {
              name: "fullName",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Patient's full name if already known; omit if unknown" },
              required: false,
            },
          ],
          staticParameters,
          http: { baseUrlPattern: `${base}/patients/identify`, httpMethod: "POST" },
        },
      },
      {
        temporaryTool: {
          modelToolName: "update_patient",
          description:
            "Update the patient's profile with details collected during the conversation. " +
            "Call this whenever the patient provides or corrects their full name, age, or gender. " +
            "Only send fields the patient has explicitly confirmed; omit fields that are still unknown. " +
            "patientId is available in your call context.",
          dynamicParameters: [
            {
              name: "patientId",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Patient's unique identifier from your call context" },
              required: true,
            },
            {
              name: "fullName",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Patient's full name as spoken" },
              required: false,
            },
            {
              name: "age",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "integer", description: "Patient's age in years" },
              required: false,
            },
            {
              name: "gender",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", enum: ["male", "female", "other"], description: "Patient's gender" },
              required: false,
            },
          ],
          staticParameters,
          http: { baseUrlPattern: `${base}/patients/update`, httpMethod: "POST" },
        },
      },
      {
        temporaryTool: {
          modelToolName: "list_doctors",
          description:
            "Fetch all currently available doctors at this clinic. " +
            "Call this when the patient asks who is available, wants to choose a doctor, or when you need to present doctor options before booking. " +
            "Returns a list of doctors with their name, specialty, qualification, languages, and consultation fee. " +
            "clinicId is available in your call context.",
          dynamicParameters: [
            {
              name: "clinicId",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Clinic identifier from your call context" },
              required: true,
            },
          ],
          staticParameters,
          http: { baseUrlPattern: `${base}/doctors/list`, httpMethod: "POST" },
        },
      },
      {
        temporaryTool: {
          modelToolName: "book_appointment",
          description:
            "Create a new appointment for the patient. " +
            "Call this once the patient has confirmed their identity and selected a doctor. " +
            "patientId and clinicId are available in your call context; doctorId comes from list_doctors. " +
            "All other fields (symptoms, timeslot, etc.) are optional — pass null or omit them if not yet collected; the booking will not fail for missing optional fields. " +
            "Returns appointmentId, status, and formUrl. Share the formUrl with the patient at the end of the call.",
          dynamicParameters: [
            {
              name: "patientId",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Patient identifier from your call context" },
              required: true,
            },
            {
              name: "clinicId",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Clinic identifier from your call context" },
              required: true,
            },
            {
              name: "doctorId",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Doctor's unique identifier chosen by the patient" },
              required: true,
            },
            {
              name: "symptoms",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Brief description of the patient's symptoms or reason for visit" },
              required: false,
            },
            {
              name: "timeslot",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Preferred appointment date/time as ISO 8601, e.g. 2026-06-15T10:30:00" },
              required: false,
            },
            {
              name: "durationMinutes",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "integer", description: "Appointment duration in minutes" },
              required: false,
            },
            {
              name: "bookerRelation",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Relationship to the patient when booking on someone else's behalf, e.g. 'parent', 'spouse'" },
              required: false,
            },
            {
              name: "proxyName",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Name of the person booking on behalf of the patient" },
              required: false,
            },
            {
              name: "notes",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Any additional notes for the appointment" },
              required: false,
            },
          ],
          staticParameters,
          http: { baseUrlPattern: `${base}/appointments/book`, httpMethod: "POST" },
        },
      },
      {
        temporaryTool: {
          modelToolName: "get_appointment_form",
          description:
            "Retrieve the patient intake form URL for a booked appointment. " +
            "Call this after book_appointment to obtain the formUrl, then read it to the patient or send it via SMS. " +
            "appointmentId is returned by book_appointment.",
          dynamicParameters: [
            {
              name: "appointmentId",
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: "string", description: "Appointment ID returned by book_appointment" },
              required: true,
            },
          ],
          staticParameters,
          http: { baseUrlPattern: `${base}/appointments/form`, httpMethod: "POST" },
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
