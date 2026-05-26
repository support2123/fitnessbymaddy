const { getSupabase } = require('./_utils/supabase');
const { checkEscalation } = require('./_utils/escalation');
const { notifyMaddy } = require('./_utils/whatsapp');
const { maskPhone } = require('./_utils/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no,
      weight, waist, compliance_score, energy,
      issues, photos
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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
        const photoData = photos[i];
        if (!photoData) continue;

        const fileName = `clients/${client_id}/checkin_w${week_no}_${i + 1}.jpg`;
        const buffer = Buffer.from(photoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');

        const { data: upload } = await db.storage
          .from('client-files')
          .upload(fileName, buffer, {
            contentType: 'image/jpeg',
            upsert: true
          });

        if (upload) {
          const { data: urlData } = db.storage
            .from('client-files')
            .getPublicUrl(fileName);
          photosUrls.push(urlData.publicUrl);
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

    if (issues) {
      const esc = checkEscalation(issues);
      if (esc.escalate) {
        await db.from('escalations').insert({
          phone: client.phone,
          reason: esc.reason,
          message_body: issues
        });
        await notifyMaddy(esc.reason, `Client: ${client.name} (${maskPhone(client.phone)})\nIssues: ${issues.slice(0, 200)}`);
      }
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.json({
      success: true,
      checkin_id: checkin.id,
      message: 'Check-in submitted successfully'
    });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
