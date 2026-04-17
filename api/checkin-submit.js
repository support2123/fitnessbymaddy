const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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
        if (typeof photo === 'string' && photo.startsWith('data:')) {
          const base64 = photo.split(',')[1];
          const mimeMatch = photo.match(/data:([^;]+);/);
          const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'jpg';
          const buffer = Buffer.from(base64, 'base64');
          const path = `clients/${client_id}/checkin_w${week_no}_${i}.${ext}`;

          await supabase.storage
            .from('programs')
            .upload(path, buffer, { contentType: mimeMatch?.[1] || 'image/jpeg', upsert: true });

          const { data: urlData } = supabase.storage.from('programs').getPublicUrl(path);
          photosUrls.push(urlData.publicUrl);
        } else if (typeof photo === 'string') {
          photosUrls.push(photo);
        }
      }
    }

    const { error: insertError } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photosUrls.length > 0 ? photosUrls : null,
    });

    if (insertError) {
      console.error('Checkin insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Health concern in check-in', {
        phone: client.phone,
        name: client.name,
        message: issues,
      });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
