# schedurx-ultravox-demo-api

Inbound Node.js API that connects a Twilio phone number to an Ultravox voice agent without n8n.

## What it does

- Accepts inbound voice webhooks from Twilio
- Verifies Twilio signatures
- Creates an Ultravox agent call with `medium.twilio`
- Returns TwiML that bridges the call to the Ultravox `joinUrl`
- Receives Ultravox lifecycle callbacks
- Stores call state in Supabase by default, with a file fallback available for local testing

## Endpoints

- `GET /health`
- `POST /webhooks/twilio/incoming`
- `POST /webhooks/twilio/status`
- `POST /webhooks/ultravox`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your env file:

```bash
copy .env.example .env
```

3. Set these required values:

- `PUBLIC_BASE_URL`
- `TWILIO_AUTH_TOKEN`
- `ULTRAVOX_API_KEY`
- `ULTRAVOX_AGENT_ID`
- `ULTRAVOX_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_CALLS_TABLE`

4. Start the API:

```bash
npm start
```

For local development:

```bash
npm run dev
```

## Twilio configuration

Point your Twilio phone number voice webhook to:

`https://your-public-domain.example.com/webhooks/twilio/incoming`

Optional status callback:

`https://your-public-domain.example.com/webhooks/twilio/status`

If you are using a reverse proxy or tunnel, `PUBLIC_BASE_URL` must match the exact public URL Twilio calls, otherwise signature validation will fail.

## Ultravox configuration

This app creates calls through `POST /api/agents/{agent_id}/calls` and attaches per-call callbacks for:

- `call.joined`
- `call.ended`
- `call.billed`

Those callbacks are delivered to:

`https://your-public-domain.example.com/webhooks/ultravox`

## Supabase table

The default Supabase repository expects a table with these columns:

- `local_call_id text primary key`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `state text not null`
- `twilio_call_sid text unique`
- `twilio_account_sid text`
- `twilio_from text`
- `twilio_to text`
- `twilio_direction text`
- `twilio_status text`
- `twilio_initial_payload jsonb`
- `twilio_status_events jsonb`
- `ultravox_call_id text unique`
- `ultravox_join_url text`
- `ultravox_status text`
- `ultravox_events jsonb`
- `last_error jsonb`

Ready-to-run SQL is included in:

`supabase/migrations/20260610_create_phone_calls.sql`

If your existing table uses different column names, I can adapt the repository to match it.

## Ultravox agent setup

This service now follows the current agent-based Ultravox flow.

Configure your prompt, voice, tools, and other reusable behavior on the Ultravox agent itself, then provide only:

- `ULTRAVOX_AGENT_ID`
- telephony medium override
- call duration and recording overrides
- callbacks
- per-call metadata

## Notes on production

This repo is runnable as-is. The default configuration expects Supabase, and the file repository remains available as a fallback for local testing with `CALL_STORE_DRIVER=file`.

## Deploy to Render

This repository includes a Render Blueprint file at `render.yaml` for a web service deploy.

1. Push this repo to GitHub.
2. In Render, create a new Blueprint instance from the repository.
3. Render will detect `render.yaml` and create the web service.
4. Set all env vars marked with `sync: false` in the Render dashboard.
5. After first deploy, copy your Render URL (for example `https://schedurx-ultravox-demo-api.onrender.com`) and set:

- `PUBLIC_BASE_URL` to that exact public URL

6. Redeploy after updating env vars.

### Render required secrets

Set these in Render:

- `PUBLIC_BASE_URL`
- `TWILIO_AUTH_TOKEN`
- `ULTRAVOX_API_KEY`
- `ULTRAVOX_AGENT_ID`
- `ULTRAVOX_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Post-deploy webhook URLs

Use your Render domain in Twilio and Ultravox:

- Twilio voice webhook: `https://your-render-domain.onrender.com/webhooks/twilio/incoming`
- Twilio optional status callback: `https://your-render-domain.onrender.com/webhooks/twilio/status`
- Ultravox callback URL: `https://your-render-domain.onrender.com/webhooks/ultravox`

Keep `PUBLIC_BASE_URL` exactly aligned with the public URL Twilio hits, or signature validation will fail.
