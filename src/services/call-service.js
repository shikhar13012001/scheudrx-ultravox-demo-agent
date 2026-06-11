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
    if (!callSid) {
      throw new BadRequestError("Missing CallSid in Twilio inbound request");
    }

    const existing = await this.repository.getByTwilioCallSid(callSid);
    if (existing?.ultravox?.joinUrl) {
      return this.#buildConnectTwiml(existing.ultravox.joinUrl);
    }

    const pending = this.pendingInboundCalls.get(callSid);
    if (pending) {
      return pending;
    }

    const task = this.#createAndBridgeCall(payload);
    this.pendingInboundCalls.set(callSid, task);

    try {
      return await task;
    } finally {
      this.pendingInboundCalls.delete(callSid);
    }
  }

  async recordTwilioStatus(payload) {
    if (!payload.CallSid) {
      throw new BadRequestError("Missing CallSid in Twilio status request");
    }

    return this.repository.appendTwilioStatusEvent(payload.CallSid, payload);
  }

  async recordUltravoxCallback(payload) {
    const callId = payload?.call?.callId;
    if (!callId) {
      return null;
    }

    return this.repository.appendUltravoxEvent(callId, payload);
  }

  async #createAndBridgeCall(payload) {
    let record = await this.repository.getByTwilioCallSid(payload.CallSid);
    if (!record) {
      record = await this.repository.createIncomingTwilioCall(payload);
    }

    const { clinicId, patientId } = await this.#bootstrapPatient(payload);

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
      return this.#buildConnectTwiml(ultravoxCall.joinUrl);
    } catch (error) {
      await this.repository.save(markBridgeFailure(record, error));

      this.logger.error(
        {
          err: error,
          twilioCallSid: payload.CallSid,
          localCallId: record.localCallId,
        },
        "Failed to create Ultravox call for inbound Twilio call",
      );

      return this.#buildFailureTwiml();
    }
  }

  // Resolves clinicId from the To number and upserts a Patient row from the From number.
  // Never throws — returns nulls so the call still connects on any DB error.
  async #bootstrapPatient(payload) {
    if (!this.supabaseClient) {
      return { clinicId: null, patientId: null };
    }

    let clinicId = null;
    let patientId = null;

    try {
      if (payload.To) {
        clinicId = phoneClinicStore.get(payload.To);
        if (!clinicId) {
          const { data: clinic } = await this.supabaseClient
            .from("Clinic")
            .select("id")
            .eq("phone", payload.To)
            .maybeSingle();
          clinicId = clinic?.id ?? null;
          if (clinicId) phoneClinicStore.set(payload.To, clinicId);
        }
      }

      if (payload.From && clinicId) {
        const { data: existing } = await this.supabaseClient
          .from("Patient")
          .select("id")
          .eq("contactNumber", payload.From)
          .eq("clinicId", clinicId)
          .maybeSingle();

        if (existing) {
          patientId = existing.id;
        } else {
          const { data: created } = await this.supabaseClient
            .from("Patient")
            .insert({
              id: `pat_${crypto.randomUUID()}`,
              clinicId,
              fullName: null,
              contactNumber: payload.From,
              createdAt: new Date().toISOString(),
            })
            .select("id")
            .single();
          patientId = created?.id ?? null;
        }
      }
    } catch (error) {
      this.logger.warn(
        { err: error, twilioFrom: payload.From, twilioTo: payload.To },
        "Patient bootstrap failed — call will continue without patient context",
      );
    }

    return { clinicId, patientId };
  }

  #buildConnectTwiml(joinUrl) {
    const response = new twilio.twiml.VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: joinUrl });
    return response.toString();
  }

  #buildFailureTwiml() {
    const response = new twilio.twiml.VoiceResponse();
    response.say(
      { voice: "alice" },
      "Sorry, we are unable to connect your call right now. Please try again in a moment.",
    );
    response.hangup();
    return response.toString();
  }
}

module.exports = { CallService };
