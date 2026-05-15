const supabase = require('./_lib/supabase');
const cors = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, next_week_focus
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'client not active' });

    // Handle photo uploads
    let photoUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < req.body.photos.length && i < 5; i++) {
        const photo = req.body.photos[i];
        if (photo && photo.data && photo.name) {
          const buf = Buffer.from(photo.data, 'base64');
          const path = `clients/${client_id}/checkins/week_${week_no}_photo_${i + 1}.jpg`;
          await supabase.storage.from('client-data').upload(path, buf, {
            contentType: 'image/jpeg',
            upsert: true
          });
          const { data: urlData } = supabase.storage.from('client-data').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    const checkinData = {
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      next_week_focus: next_week_focus || null,
      photos_urls: photoUrls.length > 0 ? photoUrls : null,
      form_submitted_at: new Date().toISOString()
    };

    if (existing) {
      await supabase.from('checkins').update(checkinData).eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert(checkinData);
    }

    // Trigger program generation for 12wk clients
    if (client.program === '12wk') {
      const generateUrl = `https://${req.headers.host}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    return res.json({ success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
