const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { handleCors, maskPhone, checkEscalation } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    let photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (photo.data && photo.name) {
          const buffer = Buffer.from(photo.data, 'base64');
          const path = `${client_id}/week_${week_no}_photo_${i + 1}.jpg`;
          const { data: uploaded } = await db.storage
            .from('clients')
            .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });

          if (uploaded) {
            const { data: urlData } = db.storage.from('clients').getPublicUrl(path);
            photosUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    const { data: checkin, error } = await db.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls,
      form_submitted_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && checkEscalation(issues)) {
      await notifyMaddy(
        `Health concern from ${client.name || maskPhone(client.phone)}`,
        `Week ${week_no} check-in issues: ${issues}`
      );
    }

    await sendTemplate(client.phone, 'checkin_received', [
      client.name || 'there',
      String(week_no)
    ]);

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    console.log(`Check-in submitted: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ ok: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
