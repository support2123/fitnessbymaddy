const { getSupabase } = require('../lib/supabase');
const { needsEscalation, maskPhone } = require('../lib/utils');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    let photoUrls = [];
    if (photos && photos.length > 0) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (photo.data && photo.name) {
          const buffer = Buffer.from(photo.data, 'base64');
          const path = `clients/${client_id}/week_${week_no}_photo_${i + 1}.jpg`;
          await db.storage
            .from('client-data')
            .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });

          const { data: urlData } = db.storage
            .from('client-data')
            .getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: checkin, error: insertErr } = await db
      .from('checkins')
      .upsert(
        {
          client_id,
          week_no: parseInt(week_no),
          weight: weight ? parseFloat(weight) : null,
          waist: waist ? parseFloat(waist) : null,
          compliance_score: compliance_score ? parseInt(compliance_score) : null,
          energy: energy ? parseInt(energy) : null,
          issues: issues || null,
          photos_urls: photoUrls,
          form_submitted_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,week_no' }
      )
      .select()
      .single();

    if (insertErr) {
      console.error('Check-in insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await sendWhatsApp('+917082478374', 'escalation_alert', [
        maskPhone(client.phone),
        'checkin_health_concern',
        issues.slice(0, 100),
      ]);
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Check-in submitted successfully',
      checkin_id: checkin.id,
    });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
