const { getClient } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { escalateToMaddy, needsEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist, compliance_score,
      energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const sb = getClient();

    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Client reported concerning issue in check-in', {
        phone: client.phone,
        name: client.name,
        message: issues,
      });
    }

    const checkinData = {
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    };

    const { error } = await sb.from('checkins').insert(checkinData);
    if (error) {
      console.error('[CHECKIN]', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    await sendTemplate(client.phone, 'checkin_received', [
      client.name || 'there',
      `Week ${week_no}`,
    ]);
    await logMessage(client.phone, 'out', `Check-in received for week ${week_no}`, 'checkin_received');

    if (['12wk'].includes(client.program)) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('[CHECKIN_GEN]', genErr.message);
      }
    }

    console.log(`[CHECKIN] Week ${week_no} for client ${client_id} (${maskPhone(client.phone)})`);
    return res.status(200).json({ status: 'saved' });
  } catch (err) {
    console.error('[CHECKIN]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
