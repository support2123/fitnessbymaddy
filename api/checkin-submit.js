// POST /api/checkin-submit
// Called by /checkin.html. Identifies the client/week by `token`
// (issued when the form was sent), stores metrics, triggers the
// program generator, and sends acknowledgement on WhatsApp.

import { supabase } from './_lib/supabase.js';
import { detectEscalation, json } from './_lib/utils.js';
import { openEscalation } from './_lib/escalation.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const body = req.body || {};
  const token = String(body.token || '').trim();
  if (!token) return json(res, 400, { error: 'missing_token' });

  const { data: checkin, error } = await supabase
    .from('checkins').select('*, clients(*)').eq('token', token).maybeSingle();
  if (error || !checkin) return json(res, 404, { error: 'invalid_token' });
  if (checkin.form_submitted_at) return json(res, 200, { ok: true, already: true });

  const update = {
    form_submitted_at: new Date().toISOString(),
    weight: num(body.weight),
    waist:  num(body.waist),
    compliance_score: clamp(num(body.compliance), 1, 10),
    energy:           clamp(num(body.energy),     1, 10),
    issues: (body.issues || '').toString().trim().slice(0, 2000) || null,
    photos_urls: Array.isArray(body.photos_urls) ? body.photos_urls : [],
    next_week_focus: (body.next_week_focus || '').toString().trim().slice(0, 300) || null,
  };

  await supabase.from('checkins').update(update).eq('id', checkin.id);

  // Escalate on risky free-text.
  const trigger = detectEscalation(update.issues || '');
  if (trigger) {
    await openEscalation({
      reason: `checkin_trigger:${trigger}`,
      phone: checkin.clients?.phone,
      clientId: checkin.client_id,
      payload: { snippet: update.issues, matched: trigger, week: checkin.week_no },
    });
  }

  // 2 consecutive missed → escalate. Check previous week.
  if (checkin.week_no >= 2) {
    const { data: prev } = await supabase.from('checkins')
      .select('week_no, form_submitted_at')
      .eq('client_id', checkin.client_id)
      .order('week_no', { ascending: false })
      .limit(3);
    const missed = (prev || []).filter(p => !p.form_submitted_at).length;
    if (missed >= 2) {
      await openEscalation({
        reason: 'missed_checkins_2x',
        phone: checkin.clients?.phone,
        clientId: checkin.client_id,
        payload: { week: checkin.week_no },
      });
    }
  }

  // For 12-week clients: fire program generator async (non-blocking).
  if (checkin.clients?.program === '12wk') {
    triggerProgramGen(checkin.client_id, checkin.week_no + 1).catch(
      e => console.error('[checkin] program gen failed', e?.message),
    );
  }

  return json(res, 200, { ok: true });
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function clamp(n, lo, hi) { return n == null ? null : Math.max(lo, Math.min(hi, n)); }

async function triggerProgramGen(clientId, weekNo) {
  const url = `${process.env.PUBLIC_SITE_URL || ''}/api/generate-program`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_SECRET || ''}`,
    },
    body: JSON.stringify({ client_id: clientId, week_no: weekNo }),
  });
}
