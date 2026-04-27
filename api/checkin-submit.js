const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { isHinglish, detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id, phone, name, program, status')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'client not active' });

    // Check for escalation triggers
    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('checkin_health_flag', client.phone, issues.slice(0, 300));
    }

    // Store photos to Supabase storage
    const storedPhotos = [];
    if (photos_urls && photos_urls.length > 0) {
      for (const url of photos_urls.slice(0, 3)) {
        storedPhotos.push(url);
      }
    }

    // Insert checkin
    const { data: checkin } = await db
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
        energy: energy ? parseInt(energy, 10) : null,
        issues: issues || null,
        photos_urls: storedPhotos
      })
      .select('id')
      .single();

    // Send confirmation
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const confirmMsg = hinglish
      ? `Week ${week_no} check-in received! ✅ Aapka progress track ho raha hai. Keep going! 💪`
      : `Week ${week_no} check-in received! ✅ Your progress is being tracked. Keep going! 💪`;

    await sendWhatsApp({ phone: client.phone, body: confirmMsg });

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({
            client_id: client.id,
            week_no: parseInt(week_no, 10) + 1
          })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    // Check for 2 consecutive missed checkins (escalation)
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(3);

    if (recentCheckins && recentCheckins.length > 0) {
      const weeks = recentCheckins.map(c => c.week_no).sort((a, b) => b - a);
      const currentWeek = parseInt(week_no, 10);
      if (currentWeek >= 3 && !weeks.includes(currentWeek - 1) && !weeks.includes(currentWeek - 2)) {
        await escalateToMaddy('missed_checkins', client.phone, `2 consecutive weeks missed before week ${currentWeek}`);
      }
    }

    return res.json({ success: true, checkin_id: checkin?.id });

  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
