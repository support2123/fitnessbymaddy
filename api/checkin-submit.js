const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Verify client exists and is active
    const { data: client } = await db
      .from('clients')
      .select('id, program, status')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    // Upload photos if provided (base64 array)
    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photoData = photos[i];
        if (!photoData) continue;

        const buffer = Buffer.from(photoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const path = `clients/${client_id}/checkin_w${week_no}_${i + 1}.jpg`;

        const { error: uploadErr } = await db.storage
          .from('client-files')
          .upload(path, buffer, {
            contentType: 'image/jpeg',
            upsert: true
          });

        if (!uploadErr) {
          const { data: urlData } = db.storage
            .from('client-files')
            .getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    // Insert check-in record
    const { error: insertErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      form_submitted_at: new Date().toISOString()
    });

    if (insertErr) {
      console.error('Checkin insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program gen trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in saved' });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
