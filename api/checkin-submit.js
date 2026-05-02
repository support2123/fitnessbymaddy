const { supabase } = require('./_lib/supabase');
const { sendWhatsAppWithRateLimit } = require('./_lib/whatsapp');
const { cors, parseBody, needsEscalation, maskPhone } = require('./_lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

    if (needsEscalation(issues)) {
      await sendWhatsAppWithRateLimit(
        MADDY_PHONE,
        'client_escalation',
        [maskPhone(client.phone), `Week ${week_no} check-in: ${(issues || '').slice(0, 150)}`],
        'Maddy',
        true
      );
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    }).select().single();

    if (error) throw error;

    await sendWhatsAppWithRateLimit(
      client.phone,
      'checkin_received',
      [client.name || 'there', String(week_no)],
      client.name || 'there',
      true
    );

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'www.fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (genErr) {
        console.error('program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
