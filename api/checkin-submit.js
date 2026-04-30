const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos,
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

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (!photo.data || !photo.name) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const path = `clients/${client_id}/week_${week_no}_photo_${i + 1}.jpg`;

        await supabase.storage
          .from('clients')
          .upload(path, buffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        const { data: urlData } = supabase.storage
          .from('clients')
          .getPublicUrl(path);

        photoUrls.push(urlData.publicUrl);
      }
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Check-in health concern', client.phone, issues);
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .upsert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photoUrls,
        form_submitted_at: new Date().toISOString(),
      }, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    if (error) throw error;

    if (client.program === '12wk') {
      const baseUrl = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('[checkin-submit]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
