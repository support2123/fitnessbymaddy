const { getClient } = require('../lib/supabase');
const { corsHeaders, maskPhone } = require('../lib/utils');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  const db = getClient();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db.from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    let photoUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < req.body.photos.length && i < 5; i++) {
        const photo = req.body.photos[i];
        if (!photo.data || !photo.name) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const path = `${client_id}/week_${week_no}_photo_${i + 1}.jpg`;

        const { error: uploadErr } = await db.storage
          .from('clients')
          .upload(path, buffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (!uploadErr) {
          const { data: urlData } = db.storage
            .from('clients')
            .getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
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
      photos_urls: photoUrls,
    }).select().single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    const { count: missedCount } = await db.from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .is('form_submitted_at', null);

    if (missedCount >= 2) {
      await notifyMaddy(
        '2+ Missed Check-ins',
        `Client ${maskPhone(client.phone)} has ${missedCount} missed check-ins`
      );
    }

    if (client.program === '12wk') {
      try {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        await fetch(`${proto}://${host}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('Program gen trigger failed:', e.message);
      }
    }

    console.log(`Check-in: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ ok: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
