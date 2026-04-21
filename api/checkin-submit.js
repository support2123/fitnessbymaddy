const { getClient } = require('../lib/supabase');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');
const { sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getClient();

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    let photosUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < Math.min(req.body.photos.length, 3); i++) {
        const photo = req.body.photos[i];
        if (photo && photo.startsWith('data:image/')) {
          const base64Data = photo.split(',')[1];
          const mimeType = photo.split(';')[0].split(':')[1];
          const ext = mimeType === 'image/png' ? 'png' : 'jpg';
          const path = `${client_id}/week_${week_no}_photo_${i + 1}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from('clients')
            .upload(path, Buffer.from(base64Data, 'base64'), {
              contentType: mimeType,
              upsert: true,
            });

          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from('clients')
              .getPublicUrl(path);
            photosUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    const { error: insertError } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photosUrls,
      form_submitted_at: new Date().toISOString(),
    });

    if (insertError) {
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await notifyMaddy(
        'Client reported concerning issue in check-in',
        { phone: client.phone, detail: `Week ${week_no}: ${issues.substring(0, 200)}` },
        { whatsapp: { sendText }, supabase }
      );
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in submitted successfully' });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
