const { getClient } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (needsEscalation(issues)) {
      await escalateToMaddy(
        'Health concern in check-in',
        client.phone,
        `Week ${week_no}: ${issues}`
      );
      await db.from('escalations').insert({
        phone: client.phone,
        reason: 'Health concern reported in weekly check-in',
        context: `Week ${week_no}: ${issues}`,
      });
    }

    const { data: checkin, error } = await db.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString(),
    }, {
      onConflict: 'client_id,week_no',
    }).select().single();

    if (error) throw error;

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          client_id,
          week_no: parseInt(week_no) + 1,
        }),
      }).catch(err => console.error('Program gen trigger failed:', err.message));
    }

    return res.status(200).json({ success: true, checkinId: checkin.id });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};
