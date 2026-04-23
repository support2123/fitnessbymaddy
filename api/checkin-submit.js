const { supabase } = require('./_lib/supabase');
const { maskPhone } = require('./_lib/helpers');
const { notifyMaddy } = require('./_lib/whatsapp');

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

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    const needsEscalation = issues && /\b(pain|dizziness|dizzy|not eating|purge|vomit|faint|chest)\b/i.test(issues);
    if (needsEscalation) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        reason: 'checkin_health_concern',
        message_body: `Week ${week_no}: ${issues}`
      });
      await notifyMaddy('Health Concern in Check-in',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nIssue: ${issues}`);
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }).select().single();

    if (error) throw error;

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
        console.error('[Checkin] Program generation trigger failed:', e.message);
      }
    }

    console.log(`[Checkin] ${maskPhone(client.phone)} week=${week_no}`);
    return res.json({ status: 'ok', checkin_id: checkin.id, escalated: !!needsEscalation });
  } catch (err) {
    console.error('[Checkin Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
