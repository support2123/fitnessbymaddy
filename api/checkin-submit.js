const { supabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/escalation');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
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

    const escalation = needsEscalation(issues);
    if (escalation.escalate) {
      const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
      await sendTemplate(maddyPhone, 'escalation_alert', [
        client.name || 'Client',
        `Check-in W${week_no} flagged: ${escalation.reason}`,
        (issues || '').slice(0, 200),
      ]);
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .upsert({
        client_id,
        week_no: parseInt(week_no, 10),
        form_submitted_at: new Date().toISOString(),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
        energy: energy ? parseInt(energy, 10) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
      }, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    if (error) throw error;

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};
