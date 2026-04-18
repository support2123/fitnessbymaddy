const { supabase } = require('../lib/supabase');
const { sendMessage } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Verify client
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    // Upload photos
    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photoData = photos[i];
        if (!photoData) continue;
        const base64 = photoData.includes(',') ? photoData.split(',')[1] : photoData;
        const buffer = Buffer.from(base64, 'base64');
        const path = `${client_id}/checkin_w${week_no}_${i}.jpg`;

        const { error: uploadErr } = await supabase.storage
          .from('clients')
          .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });

        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from('clients').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    // Save check-in
    const { error: checkinErr } = await supabase
      .from('checkins')
      .upsert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photoUrls.length > 0 ? photoUrls : null,
      }, { onConflict: 'client_id,week_no' });

    if (checkinErr) {
      console.error('Check-in save error:', checkinErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Check for escalation triggers in issues
    if (issues) {
      const lowerIssues = issues.toLowerCase();
      const dangerKeywords = ['pain', 'dizzy', 'faint', 'vomit', 'eating disorder', 'chest'];
      if (dangerKeywords.some(kw => lowerIssues.includes(kw))) {
        await escalateToMaddy('Concerning issue reported in check-in', {
          phone: client.phone,
          name: client.name,
          messageBody: `Week ${week_no} check-in issue: ${issues}`,
        });
      }
    }

    // Check 2 consecutive missed check-ins
    if (parseInt(week_no) >= 3) {
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client_id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
      const currentWeek = parseInt(week_no);
      if (!submittedWeeks.includes(currentWeek - 1) && !submittedWeeks.includes(currentWeek - 2)) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
        });
      }
    }

    // Trigger program generation for 12-week clients
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
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    // Send confirmation
    await sendMessage(client.phone, {
      text: `✅ Week ${week_no} check-in received! ${client.program === '12wk' ? 'Your next week plan is being prepared.' : 'Keep up the great work!'}`,
      isClient: true,
    });

    return res.status(200).json({ ok: true, message: 'Check-in submitted successfully' });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
