const { getSupabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/escalation');

module.exports = async function handler(req, res) {
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

    const supabase = getSupabase();

    const { data: client } = await supabase
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
      for (const photo of photos.slice(0, 3)) {
        if (photo.data && photo.name) {
          const buffer = Buffer.from(photo.data, 'base64');
          const filePath = `${client_id}/week_${week_no}/${photo.name}`;
          const { data: uploaded } = await supabase.storage
            .from('clients')
            .upload(filePath, buffer, { contentType: photo.type || 'image/jpeg', upsert: true });
          if (uploaded) {
            const { data: urlData } = supabase.storage.from('clients').getPublicUrl(filePath);
            photosUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    const { error: insertError } = await supabase.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photosUrls,
      form_submitted_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' });

    if (insertError) {
      console.error('Check-in insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Check for consecutive missed check-ins
    const prevWeek = parseInt(week_no) - 1;
    if (prevWeek > 0) {
      const { data: prevCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client_id)
        .eq('week_no', prevWeek)
        .single();

      if (!prevCheckin) {
        const weekBefore = prevWeek - 1;
        if (weekBefore > 0) {
          const { data: olderCheckin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client_id)
            .eq('week_no', weekBefore)
            .single();

          if (!olderCheckin) {
            await notifyMaddy(
              '2 consecutive missed check-ins',
              `Client: ${client.name || maskPhone(client.phone)}\nPhone: ${maskPhone(client.phone)}\nMissed weeks ${weekBefore} and ${prevWeek}`
            );
          }
        }
      }
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    await sendTemplate(client.phone, 'checkin_thanks', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(week_no)]
    });

    return res.status(200).json({ ok: true, message: 'Check-in submitted' });

  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
