const { supabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy, checkMissedCheckins } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
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
    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client not active' });
    }

    let photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (!photo.data || !photo.type) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const ext = photo.type.split('/')[1] || 'jpg';
        const path = `${client_id}/checkins/week_${week_no}_${i + 1}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from('clients')
          .upload(path, buffer, {
            contentType: photo.type,
            upsert: true
          });

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('clients')
            .getPublicUrl(path);
          if (urlData?.publicUrl) photosUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: checkin, error: insertErr } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
        energy: energy ? parseInt(energy, 10) : null,
        issues: issues || null,
        photos_urls: photosUrls
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy(
        client.phone,
        'Health concern in check-in',
        `Week ${week_no}: ${issues}`
      );
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
