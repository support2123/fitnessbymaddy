// Generate a weekly program for a 12wk client: Claude → JSON → PDF →
// Supabase Storage → WhatsApp delivery → audit row. Idempotent per
// (client_id, week_no).

import { supa } from '../lib/supabase.js';
import { generateProgram } from '../lib/claude.js';
import { renderProgramPdf } from '../lib/pdf.js';
import { sendText, sendTemplate } from '../lib/aisensy.js';
import { jsonResponse, readBody, normalisePhone, maskPhone, detectMarket } from '../lib/utils.js';
import { COPY } from '../lib/router.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });

  const secret = req.headers['x-internal-secret'] || req.headers['x-vercel-cron'];
  if (!secret) return jsonResponse(res, 401, { error: 'unauthorised' });
  if (req.headers['x-internal-secret'] &&
      req.headers['x-internal-secret'] !== process.env.SUPABASE_SERVICE_KEY) {
    return jsonResponse(res, 401, { error: 'unauthorised' });
  }

  const body = await readBody(req);
  const clientId = body.client_id;
  const weekNo = parseInt(body.week_no, 10);
  if (!clientId || !Number.isFinite(weekNo)) {
    return jsonResponse(res, 400, { error: 'client_id_and_week_required' });
  }

  const { data: client, error: cErr } = await supa()
    .from('clients').select('*').eq('id', clientId).single();
  if (cErr || !client) return jsonResponse(res, 404, { error: 'client_not_found' });
  if (client.program !== '12wk') {
    return jsonResponse(res, 200, { ok: true, skipped: 'not_12wk' });
  }

  // Idempotency: skip if already generated.
  const { data: existing } = await supa()
    .from('programs').select('id, pdf_url, halted')
    .eq('client_id', clientId).eq('week_no', weekNo).maybeSingle();
  if (existing?.pdf_url) return jsonResponse(res, 200, { ok: true, skipped: 'already_generated' });

  // Last two check-ins for context.
  const { data: checkins } = await supa()
    .from('checkins').select('*')
    .eq('client_id', clientId).order('week_no', { ascending: false }).limit(2);

  // Build profile from the lead's intake blob if present.
  let profile = { name: client.name, program: client.program, market: client.market };
  if (client.lead_id) {
    const { data: lead } = await supa()
      .from('leads').select('first_msg').eq('id', client.lead_id).maybeSingle();
    if (lead?.first_msg) {
      try { profile = { ...profile, ...JSON.parse(lead.first_msg) }; } catch {}
    }
  }

  // Call Claude.
  let plan;
  try { plan = await generateProgram({ profile, checkins: checkins || [] }); }
  catch (e) {
    await supa().from('programs').insert({
      client_id: clientId, week_no: weekNo, halted: true,
      halt_reason: `claude_error:${e.message.slice(0, 200)}`
    });
    await notifyMaddy(`Program generation failed for ${maskPhone(client.phone)} week ${weekNo}: ${e.message.slice(0,200)}`);
    return jsonResponse(res, 500, { error: 'claude_failed' });
  }

  if (plan.halt) {
    await supa().from('programs').insert({
      client_id: clientId, week_no: weekNo,
      halted: true, halt_reason: plan.halt_reason || 'halt',
      workout_plan: null, nutrition_plan: null
    });
    await notifyMaddy(`HALTED program for ${maskPhone(client.phone)} week ${weekNo}: ${plan.halt_reason}`);
    return jsonResponse(res, 200, { ok: true, halted: true, reason: plan.halt_reason });
  }

  // PDF.
  const pdfBuf = await renderProgramPdf({ clientName: client.name, weekNo, plan });
  const path = `${clientId}/week_${weekNo}.pdf`;
  const up = await supa().storage.from('clients')
    .upload(path, pdfBuf, { upsert: true, contentType: 'application/pdf' });
  if (up.error) {
    await notifyMaddy(`PDF upload failed for ${maskPhone(client.phone)} week ${weekNo}: ${up.error.message}`);
    return jsonResponse(res, 500, { error: up.error.message });
  }
  const { data: signed } = await supa().storage.from('clients')
    .createSignedUrl(path, 60 * 60 * 24 * 14); // 14 days
  const pdfUrl = signed?.signedUrl || null;

  // Audit + WhatsApp.
  await supa().from('programs').insert({
    client_id: clientId, week_no: weekNo,
    pdf_url: pdfUrl,
    workout_plan: plan.workout_plan,
    nutrition_plan: plan.nutrition_plan,
    notes: plan.notes || null,
    whatsapp_sent_at: new Date().toISOString()
  });

  const market = client.market || detectMarket(client.phone);
  const line = (market === 'IN' ? COPY.programDelivery.IN : COPY.programDelivery.EN)(weekNo);
  if (pdfUrl) {
    await sendText({ phone: client.phone, body: `${line}\n${pdfUrl}` });
  } else {
    await sendText({ phone: client.phone, body: line });
  }

  return jsonResponse(res, 200, { ok: true, pdf: pdfUrl });
}

async function notifyMaddy(msg) {
  const maddy = normalisePhone(process.env.MADDY_WA_NUMBER);
  if (!maddy) return;
  try { await sendText({ phone: maddy, body: msg }); } catch {}
}
