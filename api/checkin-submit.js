const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id, phone, program, name')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (photo.startsWith('data:')) {
          const base64 = photo.split(',')[1];
          const buffer = Buffer.from(base64, 'base64');
          const ext = photo.includes('png') ? 'png' : 'jpg';
          const path = `clients/${client_id}/checkins/week_${week_no}_photo_${i + 1}.${ext}`;

          await db.storage.from('client-files').upload(path, buffer, {
            contentType: `image/${ext}`,
            upsert: true,
          });

          const { data: urlData } = db.storage.from('client-files').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Client reported concerning issue in check-in', {
        phone: maskPhone(client.phone),
        message: `Week ${week_no}: ${issues}`,
      });
    }

    const { data: checkin, error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photoUrls,
      next_week_focus: null,
    }).select().single();

    if (error) throw error;

    if (client.program === '12wk') {
      fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};
