const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos,
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

    let photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (photo.startsWith('data:')) {
          const base64Data = photo.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          const path = `${client_id}/week_${week_no}/photo_${i + 1}.jpg`;

          const { data: upload } = await supabase.storage
            .from('clients')
            .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });

          if (upload) {
            const { data: urlData } = supabase.storage.from('clients').getPublicUrl(path);
            photosUrls.push(urlData.publicUrl);
          }
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
      photos_urls: photosUrls,
    }).select().single();

    if (error) throw error;

    const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('checkin_concern', client.phone, issues);
    }

    if (client.program === '12wk') {
      await fetch(`https://fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
