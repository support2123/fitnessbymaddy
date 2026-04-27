const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/escalation');
const { notifyMaddy, sendText } = require('../lib/whatsapp');
const { maskPhone, isHinglish, detectMarket } = require('../lib/market');

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

    const sb = getSupabase();

    // Verify client
    const { data: client } = await sb.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    // Check for escalation in issues
    const esc = needsEscalation(issues);
    if (esc.escalate) {
      await notifyMaddy(
        `Check-in flag for ${client.name || maskPhone(client.phone)} (Week ${week_no}):\n` +
        `Trigger: ${esc.reason}\n` +
        `Issues: ${(issues || '').slice(0, 300)}`
      );
    }

    // Upsert check-in
    const { data: checkin, error } = await sb.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no, 10),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) throw error;

    // Send confirmation
    const market = detectMarket(client.phone);
    if (isHinglish(market)) {
      await sendText(client.phone,
        `Week ${week_no} check-in received! 💪\n` +
        `Tumhara updated program jaldi aayega. Keep pushing!`
      );
    } else {
      await sendText(client.phone,
        `Week ${week_no} check-in received! 💪\n` +
        `Your updated program will be ready soon. Keep going!`
      );
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
      }).catch(() => {});
    }

    return res.json({ success: true, checkin_id: checkin?.id, escalated: esc.escalate });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
