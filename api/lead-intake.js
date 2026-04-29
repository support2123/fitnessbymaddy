const { supabase } = require('./_lib/supabase');
const { maskPhone } = require('./_lib/whatsapp');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      age,
      goal,
      injuries,
      diet_preference,
      schedule,
      phone,
      email,
    } = req.body || {};

    // Validate required fields
    if (!lead_id || !name || !phone) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['lead_id', 'name', 'phone'],
      });
    }

    // Build metadata object from intake form data
    const intakeData = {
      age: age || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      email: email || null,
      submitted_at: new Date().toISOString(),
    };

    // Update lead record with name and full intake metadata
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .update({
        name,
        email: email || undefined,
        metadata: intakeData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead_id)
      .select()
      .single();

    if (leadError) {
      console.error(`Failed to update lead ${lead_id} for ${maskPhone(phone)}:`, leadError.message);
      return res.status(500).json({ error: 'Failed to update lead record' });
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // If lead is already converted, also update the client record
    if (lead.status === 'converted') {
      const { data: client, error: clientLookupError } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .single();

      if (clientLookupError && clientLookupError.code !== 'PGRST116') {
        console.error(
          `Client lookup failed for ${maskPhone(phone)}:`,
          clientLookupError.message
        );
      }

      if (client) {
        const { error: clientUpdateError } = await supabase
          .from('clients')
          .update({
            name,
            email: email || undefined,
            goal: goal || undefined,
            injuries: injuries || undefined,
            diet_preference: diet_preference || undefined,
            schedule: schedule || undefined,
            age: age || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('id', client.id);

        if (clientUpdateError) {
          console.error(
            `Failed to update client for ${maskPhone(phone)}:`,
            clientUpdateError.message
          );
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
