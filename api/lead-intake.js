const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, maskPhone, jsonResponse, errorResponse } = require('./_lib/utils');
const { notifyMaddy } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const body = req.body || {};
  const {
    lead_id, name, email, age, goal, injuries, diet_pref,
    schedule, medical_conditions, phone,
  } = body;

  if (!lead_id) return errorResponse(res, 'lead_id required');

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .maybeSingle();

  if (!lead) return errorResponse(res, 'Lead not found', 404);

  await db.from('leads').update({
    name: name || lead.name,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead_id);

  const fullText = [goal, injuries, medical_conditions, diet_pref].filter(Boolean).join(' ');

  if (needsEscalation(fullText)) {
    await notifyMaddy(
      'Intake form - medical flag',
      `Lead: ${maskPhone(lead.phone)}\nName: ${name}\nIssue: ${fullText.slice(0, 500)}`
    );
  }

  return jsonResponse(res, { ok: true, lead_id });
};
