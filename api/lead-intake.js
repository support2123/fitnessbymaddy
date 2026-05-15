const { getSupabase } = require('../lib/supabase');
const { jsonResponse, errorResponse, validateRequired, sanitizeInput } = require('../lib/utils');

module.exports = async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }});
  }

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const body = await req.json();
  const err = validateRequired(body, ['lead_id', 'name', 'email', 'age', 'goal']);
  if (err) return errorResponse(err);

  const db = getSupabase();

  // Verify lead exists
  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', body.lead_id)
    .single();

  if (!lead) return errorResponse('Lead not found', 404);

  // Update lead with intake info
  await db.from('leads').update({
    name: sanitizeInput(body.name)
  }).eq('id', lead.id);

  // Store intake data as a client record (pre-payment, status will update on conversion)
  const intakeData = {
    lead_id: lead.id,
    phone: lead.phone,
    name: sanitizeInput(body.name),
    email: sanitizeInput(body.email),
    program: lead.program_interest,
    status: 'active',
    paid_amount: 0
  };

  // Check if client already exists for this lead
  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('lead_id', lead.id)
    .limit(1)
    .single();

  if (existingClient) {
    await db.from('clients').update(intakeData).eq('id', existingClient.id);
  } else {
    await db.from('clients').insert(intakeData);
  }

  return jsonResponse({ success: true, message: 'Intake form received' });
};
