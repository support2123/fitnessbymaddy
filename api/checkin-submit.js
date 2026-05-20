const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Verify client exists and is active
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    // Check for escalation in issues text
    if (needsEscalation(issues)) {
      await escalateToMaddy(
        'Health concern in weekly check-in',
        client.phone,
        `Week ${week_no}: ${issues}`
      );
    }

    // Insert check-in
    const { data: checkin, error: insertErr } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
        energy: energy ? parseInt(energy, 10) : null,
        issues: issues || null,
        photos_urls: photos_urls || []
      })
      .select()
      .single();

    if (insertErr) {
      console.error(`Check-in insert failed for ${maskPhone(client.phone)}:`, insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Send confirmation to client
    await sendTemplate(client.phone, 'checkin_received', [
      client.name ? client.name.split(' ')[0] : 'there',
      String(week_no)
    ], true);

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Check-in submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
