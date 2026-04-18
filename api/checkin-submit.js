const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, token,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (token) {
      const expectedToken = Buffer.from(`${client_id}-${week_no}`).toString('base64');
      if (token !== expectedToken) {
        return res.status(403).json({ error: 'Invalid token' });
      }
    }

    let photosUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (const photo of req.body.photos) {
        if (photo.data && photo.name) {
          const buffer = Buffer.from(photo.data, 'base64');
          const path = `clients/${client_id}/checkins/week_${week_no}/${photo.name}`;
          const { data: uploaded } = await db.storage
            .from('client-files')
            .upload(path, buffer, { contentType: photo.type || 'image/jpeg' });
          if (uploaded) {
            const { data: urlData } = db.storage
              .from('client-files')
              .getPublicUrl(path);
            photosUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Concerning check-in response', {
        phone: maskPhone(client.phone),
        name: client.name,
        message: `Week ${week_no} issues: ${issues}`,
      });
    }

    const { error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls,
    });

    if (error) throw error;

    if (['12wk', 'zoom_pack'].includes(client.program)) {
      try {
        const baseUrl = req.headers['x-forwarded-proto']
          ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}`
          : `https://${req.headers.host}`;

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
