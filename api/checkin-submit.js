const { supabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { cors, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, weight, waist, compliance_score, energy, issues } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id, phone, name, program')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    let photosUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (const photo of req.body.photos.slice(0, 3)) {
        if (!photo.data || !photo.name) continue;
        const buffer = Buffer.from(photo.data, 'base64');
        const path = `${client_id}/checkins/week_${week_no}_${photo.name}`;
        const { error: uploadErr } = await supabase.storage
          .from('clients')
          .upload(path, buffer, { contentType: photo.type || 'image/jpeg', upsert: true });

        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from('clients').getPublicUrl(path);
          if (urlData?.publicUrl) photosUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    const checkinData = {
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls,
      form_submitted_at: new Date().toISOString()
    };

    if (existing) {
      await supabase.from('checkins').update(checkinData).eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert(checkinData);
    }

    await sendText(client.phone,
      `Check-in for Week ${week_no} received! 🎯 ${client.name ? client.name + ', ' : ''}We'll review your progress and get back to you soon.`
    );

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error(`Program generation trigger failed for ${maskPhone(client.phone)}:`, genErr.message);
      }
    }

    return res.status(200).json({ success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
