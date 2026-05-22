const { supabase } = require('./_lib/supabase');
const { checkMissedCheckins, needsEscalation, escalate } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'client not active' });
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (!photo.data || !photo.name) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const ext = photo.name.split('.').pop() || 'jpg';
        const path = `clients/${client.phone}/checkins/week${week_no}_${i + 1}.${ext}`;

        await supabase.storage.from('client-data').upload(path, buffer, {
          contentType: photo.type || 'image/jpeg',
          upsert: true,
        });

        const { data: urlData } = supabase.storage
          .from('client-data')
          .getPublicUrl(path);

        if (urlData) photoUrls.push(urlData.publicUrl);
      }
    }

    const { data: checkin, error: checkinErr } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photoUrls,
      })
      .select()
      .single();

    if (checkinErr) {
      console.error('checkin insert error:', checkinErr.message);
      return res.status(500).json({ error: 'failed to save check-in' });
    }

    if (issues) {
      const escalationKeyword = needsEscalation(issues);
      if (escalationKeyword) {
        await escalate(client.phone, escalationKeyword, `Week ${week_no} check-in: ${issues}`);
      }
    }

    if (client.program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(() => {});
    }

    await checkMissedCheckins(client_id);

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};
