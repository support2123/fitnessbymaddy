const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/helpers');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');

module.exports = async function handler(req, res) {
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    let photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (photo.base64 && photo.name) {
          const buffer = Buffer.from(photo.base64, 'base64');
          const path = `clients/${client_id}/checkin_w${week_no}_${i + 1}.jpg`;
          const { error: uploadErr } = await db.storage
            .from('programs')
            .upload(path, buffer, {
              contentType: 'image/jpeg',
              upsert: true,
            });
          if (!uploadErr) {
            const { data: urlData } = db.storage
              .from('programs')
              .getPublicUrl(path);
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
      form_submitted_at: new Date().toISOString(),
    }, {
      onConflict: 'client_id,week_no',
    }).select().single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await db.from('escalations').insert({
        phone: client.phone,
        client_id,
        reason: 'checkin_concern',
        message: `Week ${week_no} check-in: ${issues.substring(0, 500)}`,
        status: 'pending',
      });

      const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
      await sendWhatsApp(maddyPhone, 'escalation_alert', [
        `CHECK-IN ALERT: ${client.name || maskPhone(client.phone)} reported concerns in Week ${week_no}. Review check-in.`,
      ]);
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({
            client_id,
            week_no: parseInt(week_no) + 1,
          }),
        });
      } catch (genErr) {
        console.error('Auto-generate next week error:', genErr.message);
      }
    }

    const thankMsg = `Thanks for submitting your Week ${week_no} check-in! Your coach is reviewing your progress now.`;
    await sendWhatsApp(client.phone, 'checkin_received', [thankMsg]);
    await logMessage(client.phone, 'out', thankMsg, 'checkin_received');

    return res.status(200).json({ success: true, id: checkin.id });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
