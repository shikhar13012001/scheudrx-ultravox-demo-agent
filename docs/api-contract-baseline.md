# API Contract Baseline

Generated from the current Express route wiring during the refactor baseline pass.

## Public Endpoints

- `GET /health` returns `{ ok, service, timestamp }`.
- `POST /webhooks/twilio/incoming` accepts Twilio form payloads and returns TwiML XML on success.
- `POST /webhooks/twilio/status` accepts Twilio form payloads and returns `204` on success.
- `POST /webhooks/ultravox` accepts JSON lifecycle events and returns `204` on success.
- `POST /tools/debug/echo` is intentionally unauthenticated and echoes received headers/body.
- `POST /tools/patients/identify` uses bearer auth and returns a patient JSON object with `isNew`.
- `POST /tools/patients/update` uses bearer auth and returns the patient JSON object.
- `POST /tools/doctors/list` uses bearer auth and returns `{ doctors }`.
- `POST /tools/doctors/select` uses bearer auth and returns a doctor JSON object or `{ error, availableDoctors }`.
- `POST /tools/appointments/book` uses bearer auth and returns a simple appointment JSON object with `201`.
- `POST /tools/appointments/send-form` uses bearer auth and returns `{ delivered, note, formUrl }`.
- `POST /tools/calendar/slots` uses bearer auth and, when calendar tools are mounted, returns the calendar tool envelope.
- `POST /tools/calendar/book` uses bearer auth and, when calendar tools are mounted, returns `201` with the calendar tool envelope.
- `POST /tools/calendar/reschedule` uses bearer auth and, when calendar tools are mounted, returns the calendar tool envelope.
- `POST /tools/calendar/cancel` uses bearer auth and, when calendar tools are mounted, returns the calendar tool envelope.

## Webhook Contracts

- Twilio webhooks require `X-Twilio-Signature` unless `TWILIO_VALIDATE_SIGNATURES=false`.
- Twilio inbound success response is `text/xml`.
- Twilio status success response is empty `204`.
- Ultravox webhooks require `X-Ultravox-Webhook-Timestamp` and `X-Ultravox-Webhook-Signature`.
- Ultravox signature validation uses the raw request body plus timestamp HMAC and rejects timestamps older than 60 seconds.
- `call.ended` Ultravox events remove in-memory call context for the ended `call.callId`.

## Error Model

- Standard routes return simple JSON errors: `{ "error": "message" }`.
- Tools auth failures return `401 { "error": "Unauthorized" }`.
- Twilio signature failures return `403 { "error": "Invalid Twilio signature" }`.
- Ultravox signature failures return `403 { "error": "Invalid Ultravox signature" }`.
- Calendar tool routes return structured tool errors: `{ "success": false, "error": { "code", "message", "details" } }`.
- `POST /tools/calendar/slots` intentionally uses `200` for `NO_SLOTS_AVAILABLE`.

See `docs/openapi.yaml` for the machine-readable baseline.
