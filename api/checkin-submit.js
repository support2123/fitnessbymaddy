const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { logMessage } = require('./_lib/rate-limit');
const { json, needsEscalation, maskPhone } = require('./_lib/helpers');

const MADDY_PHONE = '917082478374';
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return json(res, 400, { error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return json(res, 404, { error: 'Client not found' });
    if (client.status !== 'active') return json(res, 400, { error: 'Client not active' });

    const { error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    });

    if (error) {
      console.error('checkin insert error:', error.message);
      return json(res, 500, { error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
        maskPhone(client.phone),
        `Week ${week_no} check-in flagged: ${issues.slice(0, 200)}`,
      ]);
    }

    if (client.program === '12wk') {
      try {
        await fetch(`${BASE_URL}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    await sendWhatsApp(client.phone, 'checkin_received', [
      client.name || 'there',
      String(week_no),
    ]);
    await logMessage(client.phone, 'out', `Check-in week ${week_no} confirmed`, 'checkin_received');

    return json(res, 200, { success: true });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return json(res, 500, { error: 'Internal error' });
  }
};
