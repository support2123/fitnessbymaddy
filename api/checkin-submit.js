const { getSupabase } = require('./lib/supabase');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const db = getSupabase();

    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    let photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (const photo of photos) {
        if (photo.base64 && photo.filename) {
          const buffer = Buffer.from(photo.base64, 'base64');
          const path = `clients/${client_id}/checkins/week_${week_no}/${photo.filename}`;
          const { error: uploadErr } = await db.storage
            .from('client-files')
            .upload(path, buffer, {
              contentType: photo.contentType || 'image/jpeg',
              upsert: true,
            });

          if (!uploadErr) {
            const { data: urlData } = db.storage
              .from('client-files')
              .getPublicUrl(path);
            photosUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    const { error: insertErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photosUrls,
    });

    if (insertErr) {
      console.error('[checkin-submit] Insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && /pain|dizz|faint|vomit|chest|heart|can't breathe/i.test(issues)) {
      await escalateToMaddy('Health concern in check-in', {
        phone: client.phone,
        client_id,
        week_no,
        issues,
      });
    }

    if (client.program === '12wk') {
      try {
        await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (e) {
        console.error('[checkin-submit] Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in submitted successfully' });
  } catch (err) {
    console.error('[checkin-submit] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
