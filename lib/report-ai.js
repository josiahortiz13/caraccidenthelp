// Reads an uploaded crash report (CR-3 PDF, photos, the person's own description) with Claude and returns
// structured, uncertainty-labeled facts. Legal citations can only be ids from lib/texas-law.js (the schema
// enum enforces it). The output never contains a fault percentage, a case value, or a verdict: the schema
// has no field for them. People are referred to as "Unit 1", "Unit 2"…, never by name or ID numbers.
// Needs ANTHROPIC_API_KEY. Tests: REPORT_AI_FAKE=1 uses global.__crashhelpFakeAI(input).
const law = require('./texas-law');

const MODEL = 'claude-opus-5-5';

const BASIS = ['report_states', 'person_states', 'ai_inference', 'unknown'];
const fact = {
  type: 'object', additionalProperties: false, required: ['value', 'basis', 'source'],
  properties: {
    value: { type: 'string', description: 'The fact in plain words. Empty string when unknown.' },
    basis: { type: 'string', enum: BASIS, description: 'report_states = written in the uploaded report/document; person_states = only in the person\'s own description; ai_inference = your reading of photos/diagram or a reasonable inference (say so); unknown = not available.' },
    source: { type: 'string', description: 'Where it came from, e.g. "CR-3 p.1 field 26" or "photo 2". Empty when unknown.' },
  },
};
const facts = { type: 'array', items: fact };
const strs = { type: 'array', items: { type: 'string' } };

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['document_type', 'overview', 'parties', 'narrative', 'diagram', 'conditions', 'officer_findings', 'witnesses', 'conflicts', 'missing_info', 'evidence_checklist', 'laws', 'questions_for_lawyer', 'attorney'],
  properties: {
    document_type: { type: 'string', enum: ['texas_cr3', 'other_police_report', 'photos_only', 'insurance_document', 'description_only', 'unreadable', 'not_a_crash_document'] },
    overview: {
      type: 'object', additionalProperties: false, required: ['crash_date', 'crash_time', 'location', 'crash_type', 'vehicles_involved'],
      properties: { crash_date: fact, crash_time: fact, location: fact, crash_type: fact, vehicles_involved: fact },
    },
    parties: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['label', 'role', 'vehicle', 'commercial_vehicle', 'insurer_named', 'cited', 'injuries_reported', 'likely_the_uploader'],
        properties: {
          label: { type: 'string', description: 'Unit 1, Unit 2, Pedestrian 1… Never a name.' },
          role: { type: 'string', enum: ['driver', 'passenger', 'pedestrian', 'cyclist', 'owner', 'other'] },
          vehicle: fact, commercial_vehicle: fact, insurer_named: fact, cited: fact, injuries_reported: fact,
          likely_the_uploader: { type: 'string', enum: ['yes', 'no', 'unknown'] },
        },
      },
    },
    narrative: fact,
    diagram: fact,
    conditions: {
      type: 'object', additionalProperties: false, required: ['road', 'weather', 'light', 'traffic_control'],
      properties: { road: fact, weather: fact, light: fact, traffic_control: fact },
    },
    officer_findings: {
      type: 'object', additionalProperties: false, required: ['contributing_factors', 'citations_issued', 'observations'],
      properties: { contributing_factors: facts, citations_issued: facts, observations: facts },
    },
    witnesses: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['label', 'account'], properties: { label: { type: 'string' }, account: fact } },
    },
    conflicts: { ...strs, description: 'Places where sources disagree (two drivers\' versions, a witness vs the narrative, photos vs the report). Describe both sides; do not pick one.' },
    missing_info: { ...strs, description: 'Blank, illegible or absent information that matters.' },
    evidence_checklist: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['item', 'why', 'status'],
        properties: { item: { type: 'string' }, why: { type: 'string' }, status: { type: 'string', enum: ['have', 'missing', 'unknown'] } },
      },
    },
    laws: {
      type: 'array', description: 'Texas provisions from the provided library that commonly come up in a crash like this. Pick ids only from the enum.',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'why'],
        properties: {
          id: { type: 'string', enum: law.IDS },
          why: { type: 'string', description: 'Which reported fact makes this rule relevant. Describe the topic, never conclude that anyone violated it.' },
        },
      },
    },
    questions_for_lawyer: strs,
    attorney: {
      type: 'object', additionalProperties: false,
      required: ['liability_issues', 'comparative_responsibility_issues', 'insurance_questions', 'open_questions', 'evidence_to_obtain'],
      properties: {
        liability_issues: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['party', 'theory', 'supporting', 'contradicting'],
            properties: { party: { type: 'string' }, theory: { type: 'string' }, supporting: strs, contradicting: strs },
          },
        },
        comparative_responsibility_issues: strs,
        insurance_questions: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['coverage', 'question'],
            properties: {
              coverage: { type: 'string', enum: ['bodily_injury_liability', 'property_damage_liability', 'uninsured_motorist', 'underinsured_motorist', 'pip', 'commercial_auto', 'employer_vehicle', 'rideshare_delivery'] },
              question: { type: 'string' },
            },
          },
        },
        open_questions: strs,
        evidence_to_obtain: strs,
      },
    },
  },
};

const SYSTEM = `You organize information from Texas car crash documents for CrashHelp TX. CrashHelp TX is not a law firm and does not give legal advice.

Rules:
- Report only what the documents show. Label every fact with its basis: report_states, person_states, ai_inference, or unknown. When a field is blank or unreadable, use basis "unknown" with an empty value. Never fill a gap with a guess presented as fact.
- A police report records an officer's observations and opinions. Present them as "the officer listed…", never as established fault.
- Never state or estimate who is at fault, a percentage of fault, what a claim is worth, or whether the person "has a case".
- Refer to people only as Unit 1, Unit 2, Passenger 1, Pedestrian 1, Witness 1. Never write a person's name, address, date of birth, driver's license number, plate number, VIN, phone number or insurance policy number. Insurer company names are fine.
- For laws, choose only from the library below and explain which reported fact makes the topic relevant. Do not conclude that anyone violated a law.
- The "attorney" section is preliminary research for a licensed attorney. Give supporting AND contradicting points for every issue, and list open questions instead of resolving them.
- If the documents are not about a vehicle crash, set document_type to "not_a_crash_document" and leave the rest empty or unknown.

Law library (id: citation — topic):
${law.LAWS.map((l) => `${l.id}: ${l.cite} — ${l.title}`).join('\n')}`;

function client() {
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ timeout: 280 * 1000, maxRetries: 1 });
}

// files: [{ bytes: Buffer, contentType, name }], description: the person's own words (optional).
async function analyze({ files = [], description = '' }) {
  if (process.env.REPORT_AI_FAKE === '1') {
    if (typeof global.__crashhelpFakeAI !== 'function') throw new Error('fake AI not installed');
    return global.__crashhelpFakeAI({ files, description, schema: SCHEMA });
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ai_not_configured');

  const content = [];
  for (const f of files) {
    const data = f.bytes.toString('base64');
    if (f.contentType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: f.name || 'report.pdf' });
    else if (['image/jpeg', 'image/png', 'image/webp'].includes(f.contentType)) content.push({ type: 'image', source: { type: 'base64', media_type: f.contentType, data } });
  }
  content.push({ type: 'text', text: description ? `The person's own description of the crash (basis "person_states"):\n"""${description}"""` : 'The person did not add a written description.' });

  const response = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') throw new Error('ai_refused');
  if (response.stop_reason === 'max_tokens') throw new Error('ai_output_too_long');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { result: JSON.parse(text), model: response.model, usage: response.usage, request_id: response._request_id || null };
}

module.exports = { analyze, SCHEMA, SYSTEM, MODEL, BASIS };
