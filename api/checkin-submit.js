const { supabase } = require('./lib/supabase');
const { needsEscalation } = require('./lib/helpers');
const { notifyMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || []
      })
      .select()
      .single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await notifyMaddy('Concerning check-in response', {
        phone: client.phone,
        clientName: client.name,
        message: `Week ${week_no} issues: ${issues.slice(0, 200)}`
      });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (error) {
    console.error('Checkin error:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
