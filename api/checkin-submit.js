const supabase = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id, program, phone')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    if (existing) {
      await supabase.from('checkins').update({
        weight: parseFloat(weight) || null,
        waist: parseFloat(waist) || null,
        compliance_score: parseInt(compliance_score) || null,
        energy: parseInt(energy) || null,
        issues: issues || null,
        form_submitted_at: new Date().toISOString()
      }).eq('id', existing.id);

      return res.status(200).json({ status: 'updated', checkin_id: existing.id });
    }

    let photosUrls = [];
    if (req.body.photos_urls) {
      photosUrls = Array.isArray(req.body.photos_urls)
        ? req.body.photos_urls
        : [req.body.photos_urls];
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photosUrls,
      form_submitted_at: new Date().toISOString()
    }).select().single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = 'https://' + (req.headers.host || 'fitnessbymaddy.com');
        await fetch(baseUrl + '/api/generate-program', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ status: 'created', checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
