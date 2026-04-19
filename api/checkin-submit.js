const { getSupabase } = require('./lib/supabase');
const { checkMissedCheckins } = require('./lib/escalation');

module.exports = async (req, res) => {
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

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    let photoUrls = [];
    if (photos && photos.length > 0) {
      for (let i = 0; i < photos.length; i++) {
        const photoData = photos[i];
        if (!photoData) continue;

        const base64Data = photoData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = photoData.startsWith('data:image/png') ? 'png' : 'jpg';
        const path = `clients/${client_id}/checkin_w${week_no}_${i + 1}.${ext}`;

        const { error: uploadErr } = await db.storage
          .from('clients')
          .upload(path, buffer, {
            contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
            upsert: true
          });

        if (!uploadErr) {
          const { data: urlData } = db.storage.from('clients').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    const checkinData = {
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls
    };

    if (existing) {
      await db.from('checkins').update(checkinData).eq('id', existing.id);
    } else {
      await db.from('checkins').insert(checkinData);
    }

    if (client.program === '12wk') {
      fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({
          client_id,
          week_no: parseInt(week_no) + 1
        })
      }).catch(() => {});
    }

    await checkMissedCheckins(client_id);

    return res.status(200).json({ success: true, photos_uploaded: photoUrls.length });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};
