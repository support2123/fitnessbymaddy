const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, needsEscalation, escalateToMaddy } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const contentType = req.headers['content-type'] || '';
    let data;

    if (contentType.includes('multipart/form-data')) {
      data = req.body;
    } else {
      data = req.body;
    }

    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, token
    } = data;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    let photoUrls = [];
    if (data.photos_urls) {
      photoUrls = Array.isArray(data.photos_urls) ? data.photos_urls : [data.photos_urls];
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy(
        client.phone,
        `Week ${week_no} check-in concern: ${issues}`,
        'Client health concern in check-in'
      );
    }

    const { error: insertErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photoUrls,
      next_week_focus: null
    });

    if (insertErr) {
      console.error('Check-in insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    await sendWhatsApp(client.phone, 'checkin_received', {
      name: client.name,
      templateParams: [client.name, week_no.toString()]
    }, true);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
