const { getSupabase } = require('../lib/supabase');
const { corsHeaders, needsEscalation, maskPhone } = require('../lib/utils');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photo_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const photosArray = Array.isArray(photo_urls) ? photo_urls : [];

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photosArray,
      form_submitted_at: new Date().toISOString()
    }).select().single();

    if (issues && needsEscalation(issues)) {
      await notifyMaddy(
        'Client check-in — health flag',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nIssue: ${issues}`
      );
    }

    if (client.program === '12wk') {
      try {
        await fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
        });
      } catch {
        // Non-fatal — program generation is async
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
