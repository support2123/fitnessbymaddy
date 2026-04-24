const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy, MADDY_PHONE } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, headers);
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { client_id, preferred_date, preferred_time, reason } = body;

    if (!client_id || !preferred_date || !preferred_time) {
      res.writeHead(400, headers);
      return res.end(
        JSON.stringify({ error: 'client_id, preferred_date, and preferred_time required' })
      );
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id, phone, name, program')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      res.writeHead(404, headers);
      return res.end(JSON.stringify({ error: 'Active client not found' }));
    }

    await sendWhatsApp({
      phone: MADDY_PHONE,
      templateName: 'reschedule_request',
      bodyValues: [
        client.name || 'Client',
        preferred_date,
        preferred_time,
        reason || 'No reason given',
      ],
    });

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'reschedule_confirm',
      bodyValues: [client.name || 'there', preferred_date, preferred_time],
    });

    res.writeHead(200, headers);
    return res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error('Reschedule error:', err.message);
    res.writeHead(500, headers);
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
