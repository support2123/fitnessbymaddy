// POST /api/generate-program  { client_id, week_no }
// Auth: x-cron-secret OR called from same-origin server.
import { db, STORAGE_BUCKET } from './_lib/supabase.js';
import { sendWhatsApp } from './_lib/whatsapp.js';
import { template } from './_lib/templates.js';
import { marketForPhone } from './_lib/market.js';
import { escalate } from './_lib/escalation.js';
import { callClaude, PROGRAM_ARCHITECT_SYSTEM } from './_lib/claude.js';
import { reviewProgram } from './_lib/safety.js';
import { renderProgramPdf } from './_lib/pdf.js';
import { readJson, requireCronAuth, ok, bad } from './_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!requireCronAuth(req)) return res.status(401).json({ ok: false });

  const body = await readJson(req);
  const clientId = body.client_id;
  const weekNo = parseInt(body.week_no, 10);
  if (!clientId || !weekNo) return res.status(400).json({ ok: false, error: 'client_id + week_no required' });

  const supa = db();
  const { data: client } = await supa
    .from('clients').select('*').eq('id', clientId).maybeSingle();
  if (!client) return res.status(404).json({ ok: false, error: 'client not found' });
  if (client.program !== '12wk') {
    return res.status(200).json({ ok: true, skipped: 'not 12wk' });
  }

  // Skip if already generated.
  const { data: existing } = await supa
    .from('programs').select('id,pdf_url')
    .eq('client_id', clientId).eq('week_no', weekNo).maybeSingle();
  if (existing) return res.status(200).json({ ok: true, already: true });

  // Pull last 2 check-ins + intake meta.
  const { data: checkins } = await supa
    .from('checkins').select('*')
    .eq('client_id', clientId).order('week_no', { ascending: false }).limit(2);
  const { data: intakeMsg } = await supa
    .from('messages').select('meta')
    .eq('phone', client.phone).eq('template_name', 'intake_v1')
    .order('sent_at', { ascending: false }).limit(1).maybeSingle();
  const intake = intakeMsg?.meta?.intake || {};

  const profile = {
    name: client.name, email: client.email,
    age: intake.age, sex: intake.sex, goal: intake.goal,
    injuries: intake.injuries, diet: intake.diet,
    schedule: intake.schedule, equipment: intake.equipment,
    market: marketForPhone(client.phone),
  };

  // --- Call Claude ---
  let plan;
  try {
    const resp = await callClaude({
      system: PROGRAM_ARCHITECT_SYSTEM,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          week_no: weekNo,
          profile,
          recent_checkins: checkins || [],
        }),
      }],
      maxTokens: 4096,
    });
    const text = resp?.content?.[0]?.text || '';
    plan = JSON.parse(extractJson(text));
  } catch (err) {
    await escalate({
      phone: client.phone, clientId, trigger: 'program_generation_failed',
      context: err.message.slice(0, 280),
    });
    return res.status(500).json({ ok: false, error: 'claude_failed' });
  }

  // --- Safety review ---
  const review = reviewProgram(plan, profile);
  if (!review.safe) {
    await supa.from('programs').insert({
      client_id: clientId, week_no: weekNo,
      workout_plan: plan.workout_plan, nutrition_plan: plan.nutrition_plan,
      notes: plan.coach_notes, flagged_for_review: true,
      flag_reason: review.reasons.join('; '),
    });
    await escalate({
      phone: client.phone, clientId, trigger: 'unsafe_program',
      context: review.reasons.join('; '),
    });
    return res.status(200).json({ ok: false, flagged: true, reasons: review.reasons });
  }

  // --- Render PDF + upload ---
  const pdf = await renderProgramPdf({ client, weekNo, plan });
  const path = `${clientId}/week_${String(weekNo).padStart(2, '0')}.pdf`;
  const { error: upErr } = await supa.storage.from(STORAGE_BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (upErr) {
    await escalate({
      phone: client.phone, clientId, trigger: 'pdf_upload_failed',
      context: upErr.message.slice(0, 280),
    });
    return res.status(500).json({ ok: false, error: upErr.message });
  }
  const { data: pub } = supa.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const pdfUrl = pub.publicUrl;

  // --- Audit row ---
  await supa.from('programs').insert({
    client_id: clientId, week_no: weekNo, pdf_url: pdfUrl,
    workout_plan: plan.workout_plan, nutrition_plan: plan.nutrition_plan,
    notes: plan.coach_notes,
  });

  // --- Send via WhatsApp ---
  const market = marketForPhone(client.phone);
  const t = template('weekly_program', market, {
    week_no: String(weekNo),
    note: (plan.summary || '').slice(0, 140),
    pdf_url: pdfUrl,
  });
  const sendRes = await sendWhatsApp({
    phone: client.phone, body: t.body, templateName: t.name, bypassRateLimit: true,
    meta: { kind: 'weekly_program', week_no: weekNo },
  });
  if (sendRes.ok) {
    await supa.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', clientId).eq('week_no', weekNo);
  }

  return res.status(200).json({ ok: true, pdf_url: pdfUrl });
}

function extractJson(text) {
  // Strip code fences if present, then trim to outer braces.
  const cleaned = text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1) return cleaned;
  return cleaned.slice(first, last + 1);
}
