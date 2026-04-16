// Intake form submission handler (public POST from /intake.html).

import { supa, upsertLead, logMessage } from '../lib/supabase.js';
import { normalisePhone, detectMarket, jsonResponse, readBody, escalationReason, maskPhone } from '../lib/utils.js';
import { sendText } from '../lib/aisensy.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });
  const body = await readBody(req);

  const phone = normalisePhone(body.phone);
  if (!phone) return jsonResponse(res, 400, { error: 'phone_required' });
  const leadId = body.lead_id || null;

  const payload = {
    age: toInt(body.age),
    goal: body.goal || null,
    injuries: body.injuries || null,
    diet: body.diet || null,
    schedule: body.schedule || null,
    notes: body.notes || null,
    height_cm: toInt(body.height_cm),
    weight_kg: toFloat(body.weight_kg),
    experience: body.experience || null
  };

  // Persist by stitching into the lead's source + notes fields we have.
  // Use an intake-specific column via upsert into leads (program_interest stays stable).
  const lead = await upsertLead({
    phone,
    name: body.name || null,
    source: 'intake_form',
    status: 'qualified',
    first_msg: JSON.stringify(payload),
    last_msg_at: new Date().toISOString(),
    market: detectMarket(phone)
  });

  await logMessage({ phone, direction: 'in', body: JSON.stringify(payload), status: 'intake_form' });

  // Escalate on risky disclosures.
  const risky = escalationReason(
    [payload.injuries, payload.notes].filter(Boolean).join(' ')
  );
  if (risky) {
    await supa().from('leads').update({
      escalated: true, escalation_reason: `intake:${risky}`
    }).eq('id', lead.id);
    const maddy = normalisePhone(process.env.MADDY_WA_NUMBER);
    if (maddy) {
      await sendText({
        phone: maddy,
        body: `INTAKE FLAG → ${maskPhone(phone)}\nReason: ${risky}\nNotes: ${(payload.notes||'').slice(0,200)}`
      });
    }
  }

  return jsonResponse(res, 200, { ok: true, lead_id: lead.id });
}

function toInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function toFloat(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
