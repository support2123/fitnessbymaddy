const { getSupabase } = require('./_lib/supabase');
const { checkEscalation } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask-phone');
const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
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
      .select('id, phone, name, program')
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
        const fileName = `clients/${client_id}/checkin_w${week_no}_${i + 1}_${Date.now()}.jpg`;
        const buffer = Buffer.from(photoData.split(',')[1] || photoData, 'base64');
        const { data: uploaded } = await db.storage
          .from('client-files')
          .upload(fileName, buffer, { contentType: 'image/jpeg' });
        if (uploaded) {
          const { data: urlData } = db.storage.from('client-files').getPublicUrl(fileName);
          photosUrls.push(urlData.publicUrl);
        }
      }
    }

    if (issues) {
      const escalation = checkEscalation(issues);
      if (escalation) {
        await sendWhatsApp({
          phone: '+917082478374',
          templateName: 'escalation_alert',
          body: `🚨 CHECK-IN ESCALATION\nClient: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nIssues: "${issues.slice(0, 200)}"\nTriggers: ${escalation.join(', ')}`,
        });
      }
    }

    const { error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photosUrls,
    });

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program gen trigger failed:', genErr.message);
      }
    }

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'checkin_received',
      body: `Thanks for your Week ${week_no} check-in! 💪 Your updated program will be with you soon.`,
    });

    return res.status(200).json({ success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
