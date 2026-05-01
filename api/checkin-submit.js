const supabase = require('../lib/supabase');
const { sendSessionMessage } = require('../lib/whatsapp');
const { needsEscalation, escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (!photo.data || !photo.name) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const path = `clients/${client_id}/checkins/week_${week_no}_${i + 1}.jpg`;

        const { data: uploaded, error: uploadError } = await supabase.storage
          .from('client-files')
          .upload(path, buffer, {
            contentType: 'image/jpeg',
            upsert: true
          });

        if (!uploadError && uploaded) {
          const { data: urlData } = supabase.storage
            .from('client-files')
            .getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: checkin, error: insertError } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photoUrls
      })
      .select()
      .single();

    if (insertError) {
      console.error('Checkin insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues) {
      const trigger = needsEscalation(issues);
      if (trigger) {
        await escalate(client.phone, trigger, issues, client_id);
      }
    }

    await sendSessionMessage(client.phone,
      `Check-in received for Week ${week_no}! ✅\n` +
      `Weight: ${weight || 'N/A'} | Waist: ${waist || 'N/A'}\n` +
      `Keep pushing — your updated plan is coming soon! 💪`
    );

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger error:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
