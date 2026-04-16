import { supa } from './_lib/supabase.js';
import { json, readBody, requireMethod } from './_lib/http.js';
import { detectRedFlags, escalate } from './_lib/escalation.js';

// Receives the /checkin.html form. Saves checkin + triggers next week's program for 12wk clients.
export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const db = supa();

  try {
    const body = await readBody(req);
    const {
      client_id,
      week_no,
      weight, waist,
      compliance_score, energy,
      issues,
      next_week_focus,
      photos_urls = []
    } = body;

    if (!client_id || !week_no) return json(res, 400, { error: 'client_id and week_no required' });

    const { data: client } = await db.from('clients').select('*').eq('id', client_id).maybeSingle();
    if (!client) return json(res, 404, { error: 'client not found' });

    const { error: upErr } = await db.from('checkins').upsert({
      client_id,
      week_no: Number(week_no),
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      next_week_focus: next_week_focus || null,
      photos_urls,
      form_submitted_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' });
    if (upErr) throw upErr;

    // Safety scan
    const risky = detectRedFlags(issues || '');
    if (risky.length) {
      await escalate({
        phone: client.phone,
        clientId: client.id,
        reason: risky.join(','),
        context: `Week ${week_no} check-in: ${issues}`
      });
    }

    // If 12-week flagship, trigger next week's program generation asynchronously.
    if (client.program === '12wk') {
      // Fire-and-forget to the generator endpoint.
      try {
        const site = process.env.SITE_URL || '';
        if (site) {
          fetch(`${site}/api/generate-program`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-token': process.env.ADMIN_TOKEN || ''
            },
            body: JSON.stringify({ client_id, week_no: Number(week_no) + 1 })
          }).catch(() => {});
        }
      } catch {}
    }

    return json(res, 200, { ok: true });
  } catch (e) {
    console.error('checkin-submit error', e.message);
    return json(res, 500, { error: 'internal' });
  }
}
