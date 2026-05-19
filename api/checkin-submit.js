const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/escalation');
const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

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
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const escalationKeyword = needsEscalation(issues);
    if (escalationKeyword) {
      await db.from('escalations').insert({
        phone: client.phone,
        client_id,
        reason: escalationKeyword,
        message_body: issues?.slice(0, 500)
      });
      await notifyMaddy(
        `Check-in flag: "${escalationKeyword}"`,
        `Client: ${client.name || maskPhone(client.phone)}, Week ${week_no}\nIssue: ${issues?.slice(0, 200)}`
      );
    }

    const { data: checkin, error } = await db.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString()
    }, {
      onConflict: 'client_id,week_no'
    }).select().single();

    if (error) {
      console.error('Checkin upsert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (err) {
        console.error('Program generation trigger failed:', err.message);
      }
    }

    return res.status(200).json({
      ok: true,
      message: 'Check-in submitted successfully',
      checkin_id: checkin?.id
    });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
