const { getSupabase } = require('../lib/supabase');
const { parseBody, handleCors, parseQuery } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const {
    lead_id,
    name,
    email,
    age,
    goal,
    injuries,
    diet_pref,
    schedule,
    phone
  } = body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  const db = getSupabase();

  // Find the lead
  let lead;
  if (lead_id) {
    const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
    lead = data;
  } else {
    const { data } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    lead = data;
  }

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  // Update lead with intake data
  await db.from('leads').update({
    name: name || lead.name,
    status: lead.status === 'new' ? 'qualified' : lead.status
  }).eq('id', lead.id);

  // Check if client already exists
  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('lead_id', lead.id)
    .limit(1);

  if (existingClient && existingClient.length > 0) {
    // Update existing client with intake info
    await db.from('clients').update({
      name: name || undefined,
      email: email || undefined,
      age: age ? parseInt(age) : undefined,
      goal: goal || undefined,
      injuries: injuries || undefined,
      diet_pref: diet_pref || undefined,
      schedule: schedule || undefined
    }).eq('id', existingClient[0].id);

    return res.status(200).json({ success: true, updated: true, client_id: existingClient[0].id });
  }

  // Store intake data in lead for now (client gets created on payment)
  // We use a temporary approach: store extra fields in the leads row won't have columns,
  // so we store as JSON in first_msg or update the client once created
  // Actually, let's create a pre-client record if they have a program interest
  if (lead.program_interest) {
    const { data: client } = await db.from('clients').insert({
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email: email || null,
      program: lead.program_interest,
      status: 'active',
      age: age ? parseInt(age) : null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      paid_amount: 0
    }).select().single();

    return res.status(200).json({ success: true, client_id: client?.id });
  }

  return res.status(200).json({ success: true, intake_saved: true });
};
