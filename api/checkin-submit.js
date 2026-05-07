const { supabase } = require('../lib/supabase');

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
      photos_urls,
      next_week_focus,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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
      .eq('week_no', parseInt(week_no))
      .limit(1)
      .single();

    if (existing) {
      await supabase
        .from('checkins')
        .update({
          weight: weight || null,
          waist: waist || null,
          compliance_score: compliance_score || null,
          energy: energy || null,
          issues: issues || null,
          photos_urls: photos_urls || [],
          next_week_focus: next_week_focus || null,
          form_submitted_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        next_week_focus: next_week_focus || null,
        form_submitted_at: new Date().toISOString(),
      });
    }

    if (client.program === '12wk') {
      const nextWeek = parseInt(week_no) + 1;
      if (nextWeek <= 12) {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: nextWeek }),
        }).catch(err => console.error('[checkin-submit] trigger failed:', err.message));
      }
    }

    return res.status(200).json({ success: true, message: 'Check-in saved' });
  } catch (err) {
    console.error('[checkin-submit]', err.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};
