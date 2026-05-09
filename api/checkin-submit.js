const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { corsHeaders, parseBody } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    // Verify client exists and is active
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    // Upload photos to storage if provided
    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photoData = photos[i];
        if (!photoData) continue;
        const fileName = `clients/${client_id}/checkin_w${week_no}_${i + 1}_${Date.now()}.jpg`;
        try {
          // photos come as base64 strings
          const buffer = Buffer.from(photoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
          await db.storage.from('client-files').upload(fileName, buffer, {
            contentType: 'image/jpeg',
            upsert: true
          });
          const { data: urlData } = db.storage.from('client-files').getPublicUrl(fileName);
          photoUrls.push(urlData.publicUrl);
        } catch (uploadErr) {
          console.error(`Photo upload ${i}:`, uploadErr.message);
        }
      }
    }

    // Check for escalation triggers in issues
    if (issues && typeof issues === 'string') {
      const lowerIssues = issues.toLowerCase();
      const escalationTerms = ['pain', 'dizzy', 'faint', 'not eating', 'injury', 'chest'];
      if (escalationTerms.some(term => lowerIssues.includes(term))) {
        await escalateToMaddy(
          'Health concern in check-in',
          `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nIssues: ${issues}`
        );
      }
    }

    // Save check-in
    const { data: checkin, error: checkinErr } = await db.from('checkins').insert({
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
    }).select().single();

    if (checkinErr) {
      console.error('Check-in save error:', checkinErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Send confirmation to client
    await sendWhatsApp(client.phone, 'checkin_received', [
      client.name || 'there',
      String(week_no)
    ], true);

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            week_no: parseInt(week_no) + 1
          })
        });
      } catch (genErr) {
        console.error('Program generation trigger:', genErr.message);
      }
    }

    // Check for consecutive missed check-ins (escalation)
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(3);

    return res.status(200).json({ success: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
