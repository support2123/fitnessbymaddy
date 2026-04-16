// Weekly check-in form handler. After saving, triggers the program generator
// for 12-week clients only.

import { db } from '../lib/supabase.js';
import { detectEscalations, escalate } from '../lib/escalation.js';
import { readJson, json, methodNotAllowed, cors } from '../lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const b = await readJson(req);
  const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = b || {};
  if (!client_id || !week_no) return json(res, 400, { ok: false, error: 'missing_client_or_week' });

  const { data: c } = await db()
    .from('clients').select('id, phone, program, status').eq('id', client_id).maybeSingle();
  if (!c) return json(res, 404, { ok: false, error: 'client_not_found' });

  await db().from('checkins').upsert({
    client_id, week_no,
    form_submitted_at: new Date().toISOString(),
    weight, waist, compliance_score, energy,
    issues, photos_urls: Array.isArray(photos_urls) ? photos_urls : []
  }, { onConflict: 'client_id,week_no' });

  // Escalate on risky check-in signals
  for (const reason of detectEscalations(issues || '')) {
    await escalate({ phone: c.phone, body: issues, clientId: c.id, reason });
  }

  // Detect two consecutive missed → handled by cron, but a sudden big weight
  // drop also deserves a look.
  if (typeof weight === 'number') {
    const { data: prev } = await db()
      .from('checkins')
      .select('weight')
      .eq('client_id', c.id)
      .lt('week_no', week_no)
      .order('week_no', { ascending: false })
      .limit(1);
    const prevW = prev?.[0]?.weight;
    if (prevW && weight && (prevW - weight) / prevW > 0.025) {
      await escalate({
        phone: c.phone, clientId: c.id, reason: 'fast_weight_drop',
        body: `week ${week_no}: ${weight}kg (prev ${prevW}kg, ${Math.round((prevW - weight) * 10) / 10}kg in 1wk)`
      });
    }
  }

  // Trigger program generation for 12-week clients
  if (c.program === '12wk' && c.status === 'active') {
    const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
    // Fire-and-forget — we don't block the form submission
    fetch(`${base}/api/generate-program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal': process.env.CRON_SECRET || '' },
      body: JSON.stringify({ client_id: c.id, week_no: week_no + 1 })
    }).catch(err => console.error('generate-program dispatch failed', err.message));
  }

  return json(res, 200, { ok: true });
}
