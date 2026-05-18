const { supabase } = require('./_lib/supabase');
const { needsEscalation } = require('./_lib/escalation');
const { notifyMaddy, sendTemplate } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing required: client_id, week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    const { escalate, reason } = needsEscalation(issues);
    if (escalate) {
      await notifyMaddy(
        'Check-in escalation',
        `Client: ${client.name}\nWeek: ${week_no}\nKeyword: ${reason}\nIssues: ${issues}`
      );
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (!photo.data || !photo.name) continue;
        const buffer = Buffer.from(photo.data, 'base64');
        const path = `clients/${client_id}/checkins/week_${week_no}_${i + 1}.jpg`;
        await supabase.storage.from('clients').upload(path, buffer, {
          contentType: 'image/jpeg',
          upsert: true
        });
        const { data: urlData } = supabase.storage.from('clients').getPublicUrl(path);
        photoUrls.push(urlData.publicUrl);
      }
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls
    }).select().single();

    if (error) throw error;

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    await sendTemplate(client.phone, 'checkin_received', [
      client.name || 'there',
      String(week_no)
    ]);

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
