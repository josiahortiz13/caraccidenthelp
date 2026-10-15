# CRM adapter

`lib/crm.js` syncs every lead to your CRM on creation, on every status change, and when a call connects. Pick the mode with `CRM_MODE`.

If a sync fails, the lead stays saved in CrashHelp's own database, the failure shows on the dashboard (Twilio & Systems → CRM), and the sync is retried with backoff (1, 2, 4 … up to 240 minutes, 8 tries).

## Mode: `ghl` (GoHighLevel API v2)

Endpoints come from HighLevel's published OpenAPI spec (`services.leadconnectorhq.com`, header `Version: 2021-07-28`):

| When | Call |
| --- | --- |
| Every sync | `POST /contacts/upsert` with locationId, first/last name, phone, email, city, source "CrashHelp TX", tags `crashhelp-tx`, `src-<utm_source>`, `cmp-<utm_campaign>` |
| First sync only | `POST /contacts/{id}/notes` with crash date, city, county, injury, medical care, vehicle damage, contact preference, source/campaign, consent, lead ID |
| First sync only | `POST /opportunities/` in your pipeline, name "CrashHelp TX — Name (lead ID)", stage from the map below |
| Later syncs | `PUT /opportunities/{id}` with the new `pipelineStageId` |

HighLevel matches duplicates on phone/email according to your location's "Allow Duplicate Contact" setting.

### What you need to set

1. **Private Integration token** → `GHL_API_KEY`. HighLevel → Settings → Private Integrations → Create. Scopes: `contacts.write`, `contacts.readonly`, `opportunities.write`, `opportunities.readonly`.
2. **Location ID** → `GHL_LOCATION_ID`. Settings → Business Profile.
3. **Pipeline** → `GHL_PIPELINE_ID`. Create a pipeline named "CrashHelp TX" with these stages: NEW, CONTACT ATTEMPTED, CONTACTED, QUALIFYING, QUALIFIED, APPOINTMENT SET, REFERRED, NO RESPONSE, CLOSED.
4. **Stage IDs** → `GHL_STAGE_IDS` as JSON, for example `{"NEW":"abc","CONTACTED":"def",…}`. A status with no stage ID mapped leaves the opportunity where it is.

To find pipeline and stage IDs, call `GET https://services.leadconnectorhq.com/opportunities/pipelines?locationId=<id>` with the same headers, or ask me to and I'll walk you through it.

**Tested against:** a simulated HighLevel API that follows the published request shapes. It has not been run against your live HighLevel account yet. The first real lead in test mode will confirm it; check the CRM card on the dashboard.

## Mode: `webhook`

Sends `POST CRM_WEBHOOK_URL` with:

```json
{ "event": "lead_created | status_changed | contact_attempt | call_connected",
  "lead": { "lead_id": "...", "status": "...", "first_name": "...", "phone": "...", "crash_city": "...", "...": "..." } }
```

If `CRM_WEBHOOK_SECRET` is set, the body is signed as `X-CrashHelp-Signature: <HMAC-SHA256 hex>`. Use this for a HighLevel Workflow "Inbound Webhook" trigger, Zapier, or Make if you'd rather not use API tokens.

## Mode: `none` (default)

Leads live in the CrashHelp dashboard only.
