const db = require('./_lib/supabase');
const { cors } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const clients = await db.query('clients', `id=eq.${client_id}&select=*`);
    if (clients.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = clients[0];

    const existing = await db.query('checkins', `client_id=eq.${client_id}&week_no=eq.${week_no}&select=id`);
    if (existing.length > 0) {
      await db.update('checkins', { id: existing[0].id }, {
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, checkin_id: existing[0].id, updated: true });
    }

    const checkin = (await db.insert('checkins', {
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString(),
    }))[0];

    if (client.program === '12wk') {
      try {
        await fetch(`https://fitnessbymaddy.com/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (err) {
        console.error('Program generation trigger failed:', err.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};
