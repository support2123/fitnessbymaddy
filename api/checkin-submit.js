const { supabase } = require('./_lib/supabase');
const { needsEscalation, createEscalation } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    let photosUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < req.body.photos.length && i < 5; i++) {
        const photo = req.body.photos[i];
        if (photo.base64 && photo.filename) {
          const buffer = Buffer.from(photo.base64, 'base64');
          const path = `${client_id}/week_${week_no}/${photo.filename}`;
          const { data: uploaded } = await supabase.storage
            .from('checkin-photos')
            .upload(path, buffer, { contentType: photo.type || 'image/jpeg', upsert: true });

          if (uploaded) {
            const { data: urlData } = supabase.storage
              .from('checkin-photos')
              .getPublicUrl(path);
            if (urlData) photosUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photosUrls,
    }).select().single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    const escalationKeyword = needsEscalation(issues);
    if (escalationKeyword) {
      await createEscalation(client.phone, escalationKeyword, issues);
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger error:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
