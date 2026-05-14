import supabase from './lib/supabase.js';
import { needsEscalation, getEscalationReason, notifyMaddy } from './lib/escalation.js';
import { sendText } from './lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    let photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photoData = photos[i];
        if (!photoData) continue;

        const buffer = Buffer.from(photoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const ext = photoData.startsWith('data:image/png') ? 'png' : 'jpg';
        const filePath = `clients/${client_id}/checkin_w${week_no}_${i + 1}.${ext}`;

        await supabase.storage
          .from('client-files')
          .upload(filePath, buffer, {
            contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
            upsert: true,
          });

        const { data: urlData } = supabase.storage
          .from('client-files')
          .getPublicUrl(filePath);

        photosUrls.push(urlData.publicUrl);
      }
    }

    const { error: insertError } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photosUrls.length > 0 ? photosUrls : null,
    });

    if (insertError) {
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      const reason = getEscalationReason(issues);
      await notifyMaddy(client.phone, reason, issues, (p, m) => sendText(p, m, true));
    }

    if (client.program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://www.fitnessbymaddy.com'}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Failed to process check-in' });
  }
}
