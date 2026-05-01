const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalate } = require('../lib/escalation');
const { maskPhone } = require('../lib/phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, next_week_focus
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Handle photo uploads
    const photoUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < Math.min(req.body.photos.length, 3); i++) {
        const photo = req.body.photos[i];
        if (!photo.data || !photo.name) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const ext = photo.name.split('.').pop() || 'jpg';
        const path = `clients/${client_id}/checkin_w${week_no}_${i + 1}.${ext}`;

        await db.storage.from('clients').upload(path, buffer, {
          contentType: photo.type || 'image/jpeg',
          upsert: true
        });

        const { data: urlData } = db.storage.from('clients').getPublicUrl(path);
        if (urlData) photoUrls.push(urlData.publicUrl);
      }
    }

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      next_week_focus: next_week_focus || null
    }).select().single();

    if (issues && needsEscalation(issues)) {
      await escalate(client.phone, 'checkin_concern', issues);
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({
            client_id,
            week_no: parseInt(week_no) + 1
          })
        });
      } catch (err) {
        console.error(`Program gen trigger failed for ${maskPhone(client.phone)}:`, err.message);
      }
    }

    return res.json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
