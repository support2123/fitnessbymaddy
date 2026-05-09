const { getSupabase } = require('./_lib/supabase');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    let photosUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < req.body.photos.length && i < 5; i++) {
        const photo = req.body.photos[i];
        if (photo.base64 && photo.filename) {
          const buffer = Buffer.from(photo.base64, 'base64');
          const path = `${client_id}/week_${week_no}/${photo.filename}`;
          const { data: uploaded } = await db.storage
            .from('clients')
            .upload(path, buffer, {
              contentType: photo.contentType || 'image/jpeg',
              upsert: true
            });
          if (uploaded) {
            const { data: urlData } = db.storage.from('clients').getPublicUrl(path);
            photosUrls.push(urlData?.publicUrl || path);
          }
        }
      }
    }

    const { data: checkin } = await db.from('checkins').upsert({
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

    if (issues && (
      issues.toLowerCase().includes('pain') ||
      issues.toLowerCase().includes('dizz') ||
      issues.toLowerCase().includes('hurt')
    )) {
      await notifyMaddy(
        'Client reported issue in check-in',
        `Client: ${maskPhone(client.phone)} | Week ${week_no}\nIssue: ${issues}`
      );
    }

    if (client.program === '12wk') {
      const origin = `https://${req.headers.host}`;
      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({
          client_id: client.id,
          week_no: parseInt(week_no) + 1
        })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, checkin_id: checkin?.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
