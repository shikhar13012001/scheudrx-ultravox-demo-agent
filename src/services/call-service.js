const crypto = require("node:crypto");
const twilio = require("twilio");
const { attachUltravoxBridge, markBridgeFailure } = require("../domain/call-record");
const { BadRequestError } = require("../errors");
const callStore = require("../stores/call-store");
const phoneClinicStore = require("../stores/phone-clinic-store");

class CallService {
  constructor({ repository, ultravoxClient, logger, supabaseClient = null }) {
    this.repository = repository;
    this.ultravoxClient = ultravoxClient;
    this.logger = logger;
    this.supabaseClient = supabaseClient;
    this.pendingInboundCalls = new Map();
  }

  async handleInboundTwilioWebhook(payload) {
    const callSid = payload.CallSid;
    if (!callSid) throw new BadRequestError("Missing CallSid in Twilio inbound request");

    const existing = await this.repository.getByTwilioCallSid(callSid);
    if (existing?.ultravox?.joinUrl) return this.#connectTwiml(existing.ultravox.joinUrl);

    // Deduplicate concurrent Twilio retries for the same call.
    const pending = this.pendingInboundCalls.get(callSid);
    if (pending) return pending;

    const task = this.#createAndBridgeCall(payload);
    this.pendingInboundCalls.set(callSid, task);
    try {
      return await task;
    } finally {
      this.pendingInboundCalls.delete(callSid);
    }
  }

  async recordTwilioStatus(payload) {
    if (!payload.CallSid) throw new BadRequestError("Missing CallSid in Twilio status request");
    return this.repository.appendTwilioStatusEvent(payload.CallSid, payload);
  }

  async recordUltravoxCallback(payload) {
    const callId = payload?.call?.callId;
    if (!callId) return null;
    return this.repository.appendUltravoxEvent(callId, payload);
  }

  async #createAndBridgeCall(payload) {
    let record = await this.repository.getByTwilioCallSid(payload.CallSid);
    if (!record) record = await this.repository.createIncomingTwilioCall(payload);

    const clinicId = await this.#resolveClinicId(payload.To);
    const patientId = await this.#resolveOrCreatePatient(payload.From, clinicId);

    try {
      const ultravoxCall = await this.ultravoxClient.createInboundCall({
        localCallId: record.localCallId,
        twilioCallSid: payload.CallSid,
        twilioFrom: payload.From || "",
        twilioTo: payload.To || "",
        clinicId,
        patientId,
      });

      callStore.upsert(ultravoxCall.callId, {
        clinicId: clinicId ?? null,
        patientId: patientId ?? null,
        phoneNumber: payload.From || null,
      });

      await this.repository.save(attachUltravoxBridge(record, ultravoxCall));
      return this.#connectTwiml(ultravoxCall.joinUrl);
    } catch (error) {
      await this.repository.save(markBridgeFailure(record, error));
      this.logger.error(
        { err: error, twilioCallSid: payload.CallSid, localCallId: record.localCallId },
        "Failed to create Ultravox call for inbound Twilio call",
      );
      return this.#failureTwiml();
    }
  }

  // Looks up the clinic for a given Twilio To-number.
  // Checks the in-process cache first; falls back to Supabase and caches the result.
  // Returns null (and never throws) so the call still connects on any DB error.
  async #resolveClinicId(toPhone) {
    if (!this.supabaseClient || !toPhone) return null;

    const cached = phoneClinicStore.get(toPhone);
    if (cached) return cached;

    try {
      const { data } = await this.supabaseClient
        .from("Clinic")
        .select("id")
        .eq("phone", toPhone)
        .maybeSingle();

      const clinicId = data?.id ?? null;
      if (clinicId) phoneClinicStore.set(toPhone, clinicId);
      return clinicId;
    } catch (error) {
      this.logger.warn({ err: error, toPhone }, "Clinic lookup failed — call will continue without clinic context");
      return null;
    }
  }

  // Finds or creates a Patient row for the caller's phone number within the given clinic.
  // Returns null (and never throws) so the call still connects on any DB error.
  async #resolveOrCreatePatient(fromPhone, clinicId) {
    if (!this.supabaseClient || !fromPhone || !clinicId) return null;

    try {
      const { data: existing } = await this.supabaseClient
        .from("Patient")
        .select("id")
        .eq("contactNumber", fromPhone)
        .eq("clinicId", clinicId)
        .maybeSingle();

      if (existing) return existing.id;

      const { data: created } = await this.supabaseClient
        .from("Patient")
        .insert({
          id: `pat_${crypto.randomUUID()}`,
          clinicId,
          fullName: "",
          contactNumber: fromPhone,
          createdAt: new Date().toISOString(),
        })
        .select("id")
        .single();

      return created?.id ?? null;
    } catch (error) {
      this.logger.warn({ err: error, fromPhone, clinicId }, "Patient bootstrap failed — call will continue without patient context");
      return null;
    }
  }

  #connectTwiml(joinUrl) {
    const response = new twilio.twiml.VoiceResponse();
    response.connect().stream({ url: joinUrl });
    return response.toString();
  }

  #failureTwiml() {
    const response = new twilio.twiml.VoiceResponse();
    response.say({ voice: "alice" }, "Sorry, we are unable to connect your call right now. Please try again in a moment.");
    response.hangup();
    return response.toString();
  }
}

module.exports = { CallService };
