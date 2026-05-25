const { getClient } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, next_week_focus
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    let photoUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (const photo of req.body.photos.slice(0, 3)) {
        if (photo.data && photo.name) {
          const filePath = `${client_id}/week_${week_no}/${photo.name}`;
          const buffer = Buffer.from(photo.data, 'base64');
          await db.storage.from('checkin-photos').upload(filePath, buffer, {
            contentType: photo.type || 'image/jpeg',
            upsert: true
          });
          const { data: urlData } = db.storage.from('checkin-photos').getPublicUrl(filePath);
          if (urlData) photoUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: checkin, error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photoUrls,
      next_week_focus: next_week_focus || null
    }).select().single();

    if (error) throw error;

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Health concern in check-in', {
        phone: client.phone,
        name: client.name,
        message: issues
      });
    }

    if (client.program === '12wk') {
      const siteBase = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : (process.env.SITE_URL || 'https://fitnessbymaddy.com');

      fetch(`${siteBase}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(err => console.error('Program gen trigger failed:', err.message));
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
