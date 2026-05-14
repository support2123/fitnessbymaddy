import supabase from '../lib/supabase.js';
import { jsonResponse, needsEscalation, maskPhone } from '../lib/utils.js';
import { sendTemplate } from '../lib/whatsapp.js';

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return jsonResponse(res, 400, { error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) {
      return jsonResponse(res, 404, { error: 'Client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('checkins')
        .update({
          weight, waist, compliance_score, energy, issues,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id,
        week_no,
        weight,
        waist,
        compliance_score,
        energy,
        issues,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString(),
      });
    }

    if (issues && needsEscalation(issues)) {
      await sendTemplate(MADDY_PHONE, 'escalation_alert', [
        `⚠️ CHECK-IN ESCALATION\nClient: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nIssue: "${issues.slice(0, 200)}"`,
      ]);
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: week_no + 1 }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return jsonResponse(res, 200, { ok: true });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
}
