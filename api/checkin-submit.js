const supabase = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { needsEscalation, maskPhone, corsHeaders } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
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
      console.error('[Checkin] Insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy(
        'Client check-in concern',
        `${client.name} (${maskPhone(client.phone)}) week ${week_no}: "${issues.slice(0, 150)}"`
      );
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('[Checkin] Program generation trigger failed:', genErr.message);
      }
    }

    await sendTemplate(client.phone, 'checkin_confirmed', [
      client.name || 'there',
      String(week_no)
    ]);

    console.log(`[Checkin] Week ${week_no} submitted for ${maskPhone(client.phone)}`);
    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('[Checkin] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
