const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .limit(1);

  if (!client || client.length === 0) {
    return res.status(404).json({ error: 'Client not found' });
  }

  if (needsEscalation(issues)) {
    await escalateToMaddy({
      reason: 'Health concern in weekly check-in',
      phone: client[0].phone,
      details: `Week ${week_no}: ${issues}`
    });
  }

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .limit(1);

  if (existing && existing.length > 0) {
    await db.from('checkins').update({
      weight, waist, compliance_score, energy, issues,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString()
    }).eq('id', existing[0].id);
  } else {
    await db.from('checkins').insert({
      client_id, week_no, weight, waist,
      compliance_score, energy, issues,
      photos_urls: photos_urls || []
    });
  }

  if (client[0].program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://www.fitnessbymaddy.com';

    try {
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      });
    } catch (e) {
      console.error('Program generation trigger failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, message: 'Check-in submitted' });
};
