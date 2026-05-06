const { getSupabase } = require('./_lib/supabase');
const { jsonResponse, errorResponse, corsHeaders } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const db = getSupabase();
  const body = req.body || {};

  const {
    lead_id, name, email, phone, age, goal, injuries,
    diet_pref, schedule, experience, equipment
  } = body;

  if (!name || !phone) {
    return errorResponse(res, 'Name and phone are required');
  }

  const normalizedPhone = phone.replace(/[^0-9+]/g, '').replace(/^(\d)/, '+$1');

  // Update lead with intake info if lead_id provided
  if (lead_id) {
    await db.from('leads').update({
      name,
      status: 'qualified'
    }).eq('id', lead_id);
  }

  // Check if lead exists by phone, update or create
  const { data: existing } = await db
    .from('leads')
    .select('id')
    .eq('phone', normalizedPhone)
    .limit(1)
    .single();

  if (existing) {
    await db.from('leads').update({
      name,
      status: 'qualified',
      program_interest: goal || null
    }).eq('id', existing.id);
  } else {
    await db.from('leads').insert({
      phone: normalizedPhone,
      name,
      source: 'intake_form',
      status: 'qualified',
      program_interest: goal || null,
      market: 'GLOBAL'
    });
  }

  // Store extended profile in a metadata column or as client pre-registration
  // For now, we store key fields on the lead for when they convert
  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', normalizedPhone)
    .single();

  if (lead) {
    // We'll use the clients table to pre-populate when they convert
    // Store as a "pending" note on the lead
    const profile = JSON.stringify({
      email, age, goal, injuries, diet_pref, schedule, experience, equipment
    });
    await db.from('leads').update({
      first_msg: profile
    }).eq('id', lead.id);
  }

  return jsonResponse(res, {
    ok: true,
    message: 'Intake form submitted successfully'
  });
};
