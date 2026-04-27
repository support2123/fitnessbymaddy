const { getSupabase } = require('../lib/supabase');
const { notifyMaddy } = require('../lib/whatsapp');
const { json, cors, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return json(res, { error: 'Missing client_id or week_no' }, 400);
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return json(res, { error: 'Client not found or inactive' }, 404);

    // Upsert check-in
    const { error: upsertErr } = await db.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no, 10),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    }, { onConflict: 'client_id,week_no' });

    if (upsertErr) {
      console.error('Checkin upsert error:', upsertErr.message);
      return json(res, { error: 'Failed to save check-in' }, 500);
    }

    // Check for escalation signals in issues text
    if (issues) {
      const lower = issues.toLowerCase();
      const danger = ['pain', 'dizz', 'faint', 'eating disorder', 'vomit', 'refund', 'stop'];
      if (danger.some(d => lower.includes(d))) {
        await notifyMaddy(
          `Check-in alert — ${client.name || maskPhone(client.phone)} week ${week_no}: "${issues.slice(0, 120)}"`
        );
      }
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return json(res, { ok: true });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
