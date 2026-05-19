const { getClient } = require('./lib/supabase');
const { cors, parseBody, checkEscalation, maskPhone } = require('./lib/helpers');
const { notifyMaddy } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    const escalation = checkEscalation(issues);
    if (escalation.shouldEscalate) {
      await notifyMaddy(
        'Check-In — Health Concern',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nIssues: ${issues}\nTriggers: ${escalation.triggers.join(', ')}`
      );
    }

    const { data: checkin, error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString()
    }).select().single();

    if (error) {
      console.error('[Checkin] Insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
        });
      } catch (err) {
        console.error('[Checkin] Program generation trigger failed:', err.message);
      }
    }

    console.log(`[Checkin] Week ${week_no} submitted for client ${maskPhone(client.phone)}`);
    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('[Checkin] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
