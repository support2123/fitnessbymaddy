const supabase = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');
const { needsEscalation, classifyEscalation } = require('../lib/escalation');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    let uploadedUrls = [];
    if (photos_urls && photos_urls.length > 0) {
      uploadedUrls = photos_urls;
    }

    const { error: insertError } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: uploadedUrls
    });

    if (insertError) {
      console.error('Checkin insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      const type = classifyEscalation(issues);
      await notifyMaddy(
        `Client check-in ${type}`,
        `Client: ${client.name || client.phone}\nWeek: ${week_no}\nIssue: "${issues}"`
      );
    }

    if (client.program === '12wk') {
      try {
        await fetch('https://www.fitnessbymaddy.com/api/generate-program', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    const market = detectMarket(client.phone);
    if (isHinglish(market)) {
      await sendText(client.phone,
        `Check-in Week ${week_no} received! 💪 Maddy review karegi aur tera next week ka plan bhejegi. Keep going!`
      );
    } else {
      await sendText(client.phone,
        `Week ${week_no} check-in received! 💪 Maddy will review and send your updated plan. Keep pushing!`
      );
    }

    return res.status(200).json({ status: 'checkin_saved', week_no });
  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
