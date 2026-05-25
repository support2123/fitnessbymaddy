const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, maskPhone } = require('./_lib/escalation');
const { notifyMaddy } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, token,
      weight, waist, compliance_score, energy,
      issues, mood, sleep_quality
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    let photoUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (const photo of req.body.photos.slice(0, 3)) {
        const buffer = Buffer.from(photo.data, 'base64');
        const ext = photo.name?.split('.').pop() || 'jpg';
        const path = `clients/${client_id}/checkin_w${week_no}_${Date.now()}.${ext}`;
        await db.storage.from('client-files').upload(path, buffer, {
          contentType: photo.type || 'image/jpeg',
          upsert: true
        });
        const { data: urlData } = db.storage.from('client-files').getPublicUrl(path);
        if (urlData?.publicUrl) photoUrls.push(urlData.publicUrl);
      }
    }

    const { error: insertError } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      next_week_focus: null
    });

    if (insertError) throw insertError;

    const combinedText = [issues, mood].filter(Boolean).join(' ');
    const esc = needsEscalation(combinedText);
    if (esc.escalate) {
      await notifyMaddy(
        'Check-in Escalation',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nTriggers: ${esc.reasons.join(', ')}\nIssues: ${issues || 'none'}`
      );
    }

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
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in submitted successfully' });
  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
