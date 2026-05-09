const { getSupabase } = require('./lib/supabase');
const { needsEscalation } = require('./lib/utils');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabase();
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

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (photo.data && photo.name) {
          const buffer = Buffer.from(photo.data, 'base64');
          const path = `${client.folder_url || `clients/${client_id}`}/week_${week_no}_photo_${i + 1}.jpg`;
          await supabase.storage
            .from('clients')
            .upload(path, buffer, {
              contentType: photo.type || 'image/jpeg',
              upsert: true,
            });
          photoUrls.push(path);
        }
      }
    }

    const { data: checkin } = await supabase
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

    if (issues && needsEscalation(issues)) {
      const maddyPhone = '+917082478374';
      await sendWhatsApp(
        maddyPhone,
        `ALERT: Client ${client.name || client.phone} (week ${week_no}) reported: "${issues.slice(0, 200)}"`
      );
    }

    if (client.program === '12wk') {
      await triggerProgramGeneration(client_id, parseInt(week_no) + 1);
    }

    await sendWhatsApp(
      client.phone,
      `Check-in received for Week ${week_no}! Great job staying consistent. Your updated plan will be with you soon.`
    );

    return res.status(200).json({ ok: true, checkinId: checkin.id });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function triggerProgramGeneration(clientId, weekNo) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  try {
    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ client_id: clientId, week_no: weekNo }),
    });
  } catch (err) {
    console.error('Failed to trigger program generation:', err.message);
  }
}
