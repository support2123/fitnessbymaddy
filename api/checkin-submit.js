const { supabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, weight, waist, compliance_score, energy, issues } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Handle photo uploads
    let photosUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < req.body.photos.length && i < 3; i++) {
        const photoData = req.body.photos[i];
        if (photoData) {
          const path = `clients/${client_id}/checkins/week_${week_no}_photo_${i + 1}.jpg`;
          const buffer = Buffer.from(photoData, 'base64');
          await supabase.storage
            .from('clients')
            .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });

          const { data: urlData } = supabase.storage
            .from('clients')
            .getPublicUrl(path);

          photosUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls
    }).select().single();

    if (error) throw error;

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Health concern in check-in', client.phone, issues.slice(0, 200));
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};
