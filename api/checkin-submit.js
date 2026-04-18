const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, needsEscalation } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
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
        week_no: parseInt(week_no, 10),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
        energy: energy ? parseInt(energy, 10) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
      })
      .select()
      .single();

    if (error) {
      console.error('[checkin] Insert error:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    if (issues && needsEscalation(issues)) {
      await notifyMaddy(
        'Client health concern in check-in',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nIssues: ${issues}`
      );
    }

    await sendTemplate(client.phone, 'checkin_received', [
      client.name || 'there',
      week_no.toString(),
    ]);

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({
            client_id: client.id,
            week_no: parseInt(week_no, 10) + 1,
          }),
        });
      } catch (genErr) {
        console.error('[checkin] Program gen trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({
      ok: true,
      checkin_id: checkin.id,
    });
  } catch (err) {
    console.error('[checkin-submit] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
