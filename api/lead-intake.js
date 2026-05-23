'use strict';

const { supabase } = require('./lib/supabase');
const { maskPhone } = require('./lib/whatsapp');
const { createEscalation } = require('./lib/escalation');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// Fields extracted from the intake form
const INTAKE_FIELDS = [
  'name', 'email', 'phone', 'age', 'gender',
  'height', 'weight', 'goal_weight', 'primary_goal',
  'activity_level', 'training_experience', 'training_location',
  'injuries', 'medications', 'diet_preference', 'allergies',
  'training_days', 'workout_duration', 'notes',
];

module.exports = async function handler(req, res) {
  // ── CORS preflight ──────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS_HEADERS).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── Parse body ────────────────────────────────────────────────────────
    // Vercel provides req.body when Content-Type is application/json.
    // For multipart we expect the caller to serialize to JSON first.
    const body = req.body || {};

    // ── Reschedule shortcut ───────────────────────────────────────────────
    if (body.type === 'reschedule') {
      console.log('[intake] Reschedule request received');
      // Log to messages table as a notification record
      await supabase.from('messages').insert({
        phone: body.phone || 'unknown',
        direction: 'in',
        body: `Reschedule request: ${body.notes || JSON.stringify(body)}`,
        template_name: 'reschedule_request',
        status: 'received',
        metadata: body,
      });

      // Notify Maddy via escalation
      await createEscalation(
        body.phone || 'unknown',
        'reschedule_request',
        body.notes || 'Client requested a reschedule',
        null
      );

      return res.status(200).json({ success: true, message: 'Reschedule request received' });
    }

    // ── 1. Extract fields ─────────────────────────────────────────────────
    const intake = {};
    for (const field of INTAKE_FIELDS) {
      intake[field] = body[field] !== undefined ? body[field] : null;
    }
    const lead_id = body.lead_id || null;

    const phone  = (intake.phone  || '').trim();
    const name   = (intake.name   || '').trim() || null;
    const email  = (intake.email  || '').trim() || null;
    const masked = phone ? maskPhone(phone) : 'unknown';

    console.log(`[intake] Form submission from ${masked}`);

    // ── 2. Update or create lead ──────────────────────────────────────────
    let resolvedLeadId = lead_id;

    if (lead_id) {
      // Update the existing lead record with name + qualify it
      await supabase
        .from('leads')
        .update({
          name: name || undefined,
          status: 'qualified',
        })
        .eq('id', lead_id);

      resolvedLeadId = lead_id;
    } else if (phone) {
      // Try to find an existing lead by phone
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id, status')
        .eq('phone', phone)
        .maybeSingle();

      if (existingLead) {
        resolvedLeadId = existingLead.id;
        await supabase
          .from('leads')
          .update({
            name: name || undefined,
            status: existingLead.status === 'converted' ? 'converted' : 'qualified',
          })
          .eq('id', resolvedLeadId);
      } else {
        // Create a new lead stub from the intake form
        const { data: newLead } = await supabase
          .from('leads')
          .insert({
            phone,
            name,
            status: 'qualified',
            source: 'intake_form',
          })
          .select('id')
          .single();

        if (newLead) resolvedLeadId = newLead.id;
      }
    }

    // ── 3. Create/update client stub ──────────────────────────────────────
    if (phone) {
      const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();

      const clientData = {
        phone,
        name: name || undefined,
        email: email || undefined,
        lead_id: resolvedLeadId || undefined,
      };

      if (existingClient) {
        await supabase
          .from('clients')
          .update(clientData)
          .eq('id', existingClient.id);
      } else {
        // Only insert a client stub if they don't already exist.
        // Status stays at default ('active') — Exly webhook will confirm purchase.
        await supabase
          .from('clients')
          .insert({ ...clientData, status: 'active' });
      }
    }

    // ── 4. Medical escalation ─────────────────────────────────────────────
    const injuriesText    = (intake.injuries    || '').trim();
    const medicationsText = (intake.medications || '').trim();

    if (injuriesText || medicationsText) {
      const triggerMsg = [
        injuriesText    ? `Injuries: ${injuriesText}`       : '',
        medicationsText ? `Medications: ${medicationsText}` : '',
      ].filter(Boolean).join(' | ');

      console.log(`[intake] Medical flag for ${masked}: ${triggerMsg}`);

      await createEscalation(
        phone || 'intake_form',
        'medical_review',
        triggerMsg,
        null
      );
    }

    // ── 5. Respond ────────────────────────────────────────────────────────
    return res.status(200).json({ success: true, message: 'Intake received' });

  } catch (err) {
    console.error('[intake] Unhandled error:', err.message);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
};
