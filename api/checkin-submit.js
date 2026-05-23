const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation, checkMissedCheckins } = require('../lib/escalation');

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
      next_week_focus
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    if (needsEscalation(issues)) {
      await createEscalation(client.phone, 'Health concern in check-in', issues);
    }

    // Handle photo uploads (base64 from form)
    let photosUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < req.body.photos.length && i < 3; i++) {
        const photo = req.body.photos[i];
        if (!photo) continue;

        const buffer = Buffer.from(photo.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const path = `${client_id}/checkin_w${week_no}_${i + 1}.jpg`;

        await db.storage.from('clients').upload(path, buffer, {
          contentType: 'image/jpeg',
          upsert: true
        });

        const { data: urlData } = db.storage.from('clients').getPublicUrl(path);
        photosUrls.push(urlData.publicUrl);
      }
    }

    const { data: checkin, error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls,
      next_week_focus: next_week_focus || null
    }).select().single();

    if (error) throw error;

    if (['12wk'].includes(client.program)) {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
