const { supabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/escalation');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    let photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photoData = photos[i];
        if (photoData) {
          const buffer = Buffer.from(photoData.split(',')[1] || photoData, 'base64');
          const path = `${client_id}/checkin_w${week_no}_${i}.jpg`;
          await supabase.storage.from('clients')
            .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
          const { data: urlData } = supabase.storage.from('clients').getPublicUrl(path);
          photosUrls.push(urlData.publicUrl);
        }
      }
    }

    const { error: insertError } = await supabase.from('checkins').insert({
      client_id, week_no,
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photosUrls,
    });

    if (insertError) throw insertError;

    if (issues) {
      const esc = needsEscalation(issues);
      if (esc.escalate) {
        await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', [
          maskPhone(client.phone),
          `Week ${week_no} check-in — ${esc.keywords.join(', ')}`,
          issues.slice(0, 200),
        ]);
      }
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: week_no + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in received' });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
