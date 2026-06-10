const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { config } = require("../config");

function nowIso() {
  return new Date().toISOString();
}

function mapRowToCall(row) {
  if (!row) {
    return null;
  }

  return {
    localCallId: row.local_call_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: row.state,
    twilio: {
      callSid: row.twilio_call_sid,
      accountSid: row.twilio_account_sid,
      from: row.twilio_from,
      to: row.twilio_to,
      direction: row.twilio_direction,
      status: row.twilio_status,
      initialPayload: row.twilio_initial_payload || {},
      statusEvents: Array.isArray(row.twilio_status_events) ? row.twilio_status_events : [],
    },
    ultravox: {
      callId: row.ultravox_call_id,
      joinUrl: row.ultravox_join_url,
      status: row.ultravox_status || "pending",
      events: Array.isArray(row.ultravox_events) ? row.ultravox_events : [],
    },
    lastError: row.last_error || null,
  };
}

function mapCallToRow(call) {
  return {
    local_call_id: call.localCallId,
    created_at: call.createdAt,
    updated_at: call.updatedAt,
    state: call.state,
    twilio_call_sid: call.twilio?.callSid || null,
    twilio_account_sid: call.twilio?.accountSid || null,
    twilio_from: call.twilio?.from || null,
    twilio_to: call.twilio?.to || null,
    twilio_direction: call.twilio?.direction || null,
    twilio_status: call.twilio?.status || null,
    twilio_initial_payload: call.twilio?.initialPayload || {},
    twilio_status_events: call.twilio?.statusEvents || [],
    ultravox_call_id: call.ultravox?.callId || null,
    ultravox_join_url: call.ultravox?.joinUrl || null,
    ultravox_status: call.ultravox?.status || null,
    ultravox_events: call.ultravox?.events || [],
    last_error: call.lastError || null,
  };
}

class SupabaseCallRepository {
  constructor({ logger }) {
    this.logger = logger;
    this.table = config.SUPABASE_CALLS_TABLE;
    this.client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async init() {
    const { error } = await this.client.from(this.table).select("local_call_id").limit(1);
    if (error) {
      throw new Error(`Failed to connect to Supabase table ${this.table}: ${error.message}`);
    }
  }

  async getByTwilioCallSid(callSid) {
    const { data, error } = await this.client
      .from(this.table)
      .select("*")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase lookup by Twilio CallSid failed: ${error.message}`);
    }

    return mapRowToCall(data);
  }

  async getByUltravoxCallId(callId) {
    const { data, error } = await this.client
      .from(this.table)
      .select("*")
      .eq("ultravox_call_id", callId)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase lookup by Ultravox Call ID failed: ${error.message}`);
    }

    return mapRowToCall(data);
  }

  async createIncomingTwilioCall(payload) {
    const record = {
      localCallId: crypto.randomUUID(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      state: "received",
      twilio: {
        callSid: payload.CallSid,
        accountSid: payload.AccountSid || null,
        from: payload.From || null,
        to: payload.To || null,
        direction: payload.Direction || "inbound",
        status: payload.CallStatus || "ringing",
        initialPayload: payload,
        statusEvents: [],
      },
      ultravox: {
        callId: null,
        joinUrl: null,
        status: "pending",
        events: [],
      },
      lastError: null,
    };

    return this.save(record);
  }

  async save(call) {
    const updatedCall = {
      ...call,
      updatedAt: nowIso(),
    };

    const { data, error } = await this.client
      .from(this.table)
      .upsert(mapCallToRow(updatedCall), { onConflict: "local_call_id" })
      .select()
      .single();

    if (error) {
      throw new Error(`Supabase save failed: ${error.message}`);
    }

    return mapRowToCall(data);
  }

  async appendTwilioStatusEvent(callSid, payload) {
    let record = await this.getByTwilioCallSid(callSid);

    if (!record) {
      record = await this.createIncomingTwilioCall(payload);
    }

    record.twilio.status = payload.CallStatus || record.twilio.status;
    record.twilio.statusEvents.push({
      receivedAt: nowIso(),
      payload,
    });

    if (payload.CallStatus === "completed") {
      record.state = "completed";
    }

    return this.save(record);
  }

  async appendUltravoxEvent(callId, eventPayload) {
    const record = await this.getByUltravoxCallId(callId);
    if (!record) {
      return null;
    }

    record.ultravox.status = eventPayload.event;
    record.ultravox.events.push({
      receivedAt: nowIso(),
      payload: eventPayload,
    });

    if (eventPayload.event === "call.joined") {
      record.state = "live";
    } else if (eventPayload.event === "call.ended" || eventPayload.event === "call.billed") {
      record.state = "completed";
    }

    return this.save(record);
  }
}

module.exports = { SupabaseCallRepository };
