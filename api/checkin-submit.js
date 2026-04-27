const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Verify client exists and is active
    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client is not active' });

    // Upload photos if provided (base64 array)
    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photoData = photos[i];
        if (!photoData) continue;

        const buffer = Buffer.from(photoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const path = `${client_id}/checkin_w${week_no}_${i + 1}.jpg`;

        await sb.storage.from('clients').upload(path, buffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });

        const { data: urlData } = sb.storage.from('clients').getPublicUrl(path);
        photoUrls.push(urlData.publicUrl);
      }
    }

    // Save check-in
    const { data: checkin, error } = await sb
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photoUrls,
      })
      .select()
      .single();

    if (error) throw error;

    // Check for escalation in issues
    if (issues) {
      const keyword = needsEscalation(issues);
      if (keyword) {
        await createEscalation(client.phone, keyword, issues, client.id);
      }
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch((err) => console.error(`[CHECKIN] Program trigger failed: ${err.message}`));
    }

    return res.status(200).json({ ok: true, id: checkin.id });
  } catch (err) {
    console.error(`[CHECKIN] Error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};
