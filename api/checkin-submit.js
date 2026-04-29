const { getSupabase } = require('../lib/supabase');
const { shouldEscalate } = require('../lib/utils');
const { escalateToMaddy, checkMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id, phone, name, program')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    let photoUrls = [];
    if (req.body.photos_urls) {
      photoUrls = Array.isArray(req.body.photos_urls)
        ? req.body.photos_urls
        : [req.body.photos_urls];
    }

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
    }).select('id').single();

    const escalationKeyword = shouldEscalate(issues);
    if (escalationKeyword) {
      await escalateToMaddy(client.phone, escalationKeyword, issues);
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({
            client_id,
            week_no: parseInt(week_no) + 1,
          }),
        });
      } catch (genErr) {
        console.error('[PROGRAM GEN TRIGGER]', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('[CHECKIN ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
