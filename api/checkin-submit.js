const { supabase } = require('./lib/supabase');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (const photo of photos) {
        if (photo.base64) {
          const fileName = `clients/${client_id}/checkin_w${week_no}_${Date.now()}.jpg`;
          const { data } = await supabase.storage
            .from('client-files')
            .upload(fileName, Buffer.from(photo.base64, 'base64'), {
              contentType: 'image/jpeg'
            });
          if (data) {
            const { data: urlData } = supabase.storage
              .from('client-files')
              .getPublicUrl(fileName);
            photoUrls.push(urlData.publicUrl);
          }
        } else if (photo.url) {
          photoUrls.push(photo.url);
        }
      }
    }

    const checkinData = {
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photoUrls
    };

    await supabase.from('checkins').insert(checkinData);

    if (issues && issues.toLowerCase().match(/pain|dizz|faint|bleed|chest/)) {
      const { data: client } = await supabase
        .from('clients')
        .select('name, phone')
        .eq('id', client_id)
        .single();

      await escalateToMaddy('Health concern in check-in', {
        name: client?.name,
        phone: client?.phone,
        details: issues.slice(0, 200)
      });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('program')
      .eq('id', client_id)
      .single();

    if (client?.program === '12wk') {
      await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, message: 'Check-in recorded' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
