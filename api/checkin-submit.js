const { supabase } = require('../lib/supabase');
const { sendSessionMessage } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .limit(1)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    let photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (photo.base64 && photo.name) {
          const buffer = Buffer.from(photo.base64, 'base64');
          const path = `${client_id}/week_${week_no}/${photo.name}`;
          const { data: upload } = await supabase.storage
            .from('clients')
            .upload(path, buffer, { contentType: photo.type || 'image/jpeg' });
          if (upload) {
            const { data: url } = supabase.storage
              .from('clients')
              .getPublicUrl(path);
            photosUrls.push(url.publicUrl);
          }
        }
      }
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photosUrls,
        form_submitted_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error(`Checkin error for ${maskPhone(client.phone)}:`, error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    await sendSessionMessage(
      client.phone,
      `Check-in received for Week ${week_no}! Your coach will review it and your updated program will be sent shortly.`
    );

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin handler error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
