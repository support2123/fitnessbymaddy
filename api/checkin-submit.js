const { getSupabase } = require('../lib/supabase');
const { needsEscalation, detectEscalationType, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos, token
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db.from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client is not active' });

    let photosUrls = [];
    if (photos && photos.length > 0) {
      for (let i = 0; i < photos.length; i++) {
        const photoData = photos[i];
        if (photoData.startsWith && photoData.startsWith('data:')) {
          const base64 = photoData.split(',')[1];
          const mimeMatch = photoData.match(/data:(.*?);/);
          const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'jpg';
          const fileName = `clients/${client_id}/checkin_w${week_no}_${i + 1}.${ext}`;

          const { data: upload } = await db.storage
            .from('client-files')
            .upload(fileName, Buffer.from(base64, 'base64'), {
              contentType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
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
    }

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls
    }).select().single();

    if (issues && needsEscalation(issues)) {
      const type = detectEscalationType(issues);
      await escalateToMaddy(client.phone, client.name, type, issues);
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin?.id });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
