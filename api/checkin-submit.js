const { getSupabase } = require('./lib/supabase');
const { cors, parseBody, maskPhone } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getSupabase();

  try {
    const body = await parseBody(req);
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await sb
      .from('clients')
      .select('id, phone, program, status')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await sb
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no, 10))
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (!photo.data || !photo.name) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const path = `${client_id}/week_${week_no}/${photo.name}`;
        const { error: uploadErr } = await sb.storage
          .from('clients')
          .upload(path, buffer, {
            contentType: photo.type || 'image/jpeg',
            upsert: true
          });

        if (!uploadErr) {
          const { data: urlData } = sb.storage.from('clients').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: checkin, error: insertErr } = await sb
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
        energy: energy ? parseInt(energy, 10) : null,
        issues: issues || null,
        photos_urls: photoUrls
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Checkin insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
        });
      } catch (err) {
        console.error('Program generation trigger failed:', err.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
