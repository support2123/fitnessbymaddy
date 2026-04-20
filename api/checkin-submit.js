const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
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

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy({
        reason: 'checkin_health_concern',
        phone: client.phone,
        message: issues
      });
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: parseFloat(weight) || null,
        waist: parseFloat(waist) || null,
        compliance_score: parseInt(compliance_score) || null,
        energy: parseInt(energy) || null,
        issues: issues || null,
        photos_urls: photos_urls || []
      })
      .select()
      .single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    await sendWhatsApp({
      phone: client.phone,
      body: `✅ Check-in received for Week ${week_no}! Your updated program will be sent within 24 hours.`
    });

    if (client.program === '12wk') {
      await triggerProgramGeneration(client_id, parseInt(week_no));
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function triggerProgramGeneration(clientId, weekNo) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  await fetch(`${baseUrl}/api/generate-program`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': process.env.INTERNAL_API_KEY
    },
    body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 })
  }).catch(err => console.error('Program generation trigger failed:', err.message));
}
