const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Verify client exists and is active
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    // Upload photos to Supabase Storage
    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < Math.min(photos.length, 3); i++) {
        const photoData = photos[i];
        const buffer = Buffer.from(photoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const path = `clients/${client_id}/week_${week_no}_photo_${i + 1}.jpg`;

        const { error: uploadErr } = await supabase.storage
          .from('checkin-photos')
          .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('checkin-photos')
            .getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    // Insert check-in
    const { error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues,
      photos_urls: photoUrls
    });

    if (error) throw error;

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.json({ ok: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
