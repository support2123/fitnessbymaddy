const { getSupabase } = require('./_lib/supabase');
const { sendMediaTemplate } = require('./_lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

var PROGRAM_PROMPT = [
  'You are a certified fitness coach and nutritionist creating a weekly program.',
  'Generate a JSON object with two keys: "workout_plan" and "nutrition_plan".',
  '',
  'workout_plan should have keys for each training day (e.g. "day_1", "day_2", etc).',
  'Each day: { "focus": string, "exercises": [{ "name": string, "sets": number, "reps": string, "rest": string, "notes": string }] }',
  '',
  'nutrition_plan should have: { "calories": number, "protein_g": number, "carbs_g": number, "fats_g": number,',
  '  "meals": [{ "meal": string, "time": string, "foods": string, "macros": string }],',
  '  "supplements": [string], "hydration": string, "notes": string }',
  '',
  'Rules:',
  '- Never prescribe extreme calorie deficits (below 1200 for women, 1500 for men)',
  '- Never recommend banned substances or unproven supplements',
  '- Never promise unrealistic timelines',
  '- Adjust based on compliance, energy, and reported issues',
  '- Be progressive: increase intensity gradually week over week',
  '- Account for injuries and medical conditions mentioned',
  '',
  'Return ONLY valid JSON. No markdown, no explanation.'
].join('\n');

function buildContext(client, intake, checkins) {
  var lines = [
    'Client: ' + (client.name || 'Unknown'),
    'Program: ' + client.program,
    'Started: ' + (client.program_started_at || 'N/A')
  ];

  if (intake) {
    lines.push('Age: ' + (intake.age || 'N/A'));
    lines.push('Gender: ' + (intake.gender || 'N/A'));
    lines.push('Goal: ' + (intake.goal || 'N/A'));
    lines.push('Injuries: ' + (intake.injuries || 'None'));
    lines.push('Diet preference: ' + (intake.diet_pref || 'No preference'));
    lines.push('Schedule: ' + (intake.schedule || 'Flexible'));
    lines.push('Experience: ' + (intake.experience || 'Beginner'));
    lines.push('Current weight: ' + (intake.current_weight || 'N/A'));
    lines.push('Target weight: ' + (intake.target_weight || 'N/A'));
  }

  if (checkins && checkins.length > 0) {
    lines.push('\nRecent check-ins:');
    checkins.forEach(function (c) {
      lines.push('  Week ' + c.week_no + ': weight=' + (c.weight || '?') +
        ', waist=' + (c.waist || '?') +
        ', compliance=' + (c.compliance_score || '?') + '/10' +
        ', energy=' + (c.energy || '?') + '/10' +
        ', issues=' + (c.issues || 'none'));
    });
  }

  return lines.join('\n');
}

function validatePlan(plan) {
  if (!plan.workout_plan || !plan.nutrition_plan) return 'Missing workout or nutrition plan';
  var n = plan.nutrition_plan;
  if (n.calories && n.calories < 1200) return 'Calorie target too low (' + n.calories + ')';
  return null;
}

async function generatePdf(supabase, clientId, weekNo, plan, clientName) {
  return new Promise(function (resolve, reject) {
    var doc = new PDFDocument({ size: 'A4', margin: 50 });
    var chunks = [];

    doc.on('data', function (c) { chunks.push(c); });
    doc.on('end', async function () {
      var buffer = Buffer.concat(chunks);
      var path = 'clients/' + clientId + '/week_' + weekNo + '.pdf';

      var upload = await supabase.storage
        .from('clients')
        .upload(path, buffer, { contentType: 'application/pdf', upsert: true });

      if (upload.error) return reject(upload.error);

      var urlRes = supabase.storage.from('clients').getPublicUrl(path);
      resolve(urlRes.data.publicUrl);
    });
    doc.on('error', reject);

    var gold = '#B8965A';
    var charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fillColor('#FFFFFF').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fillColor(gold).fontSize(14).font('Helvetica')
      .text('Week ' + weekNo + ' Program — ' + (clientName || 'Client'), 50, 75);

    doc.fillColor(charcoal);
    var y = 150;

    doc.fontSize(18).font('Helvetica-Bold').fillColor(gold)
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    var wp = plan.workout_plan || {};
    Object.keys(wp).forEach(function (dayKey) {
      var day = wp[dayKey];
      if (y > 700) { doc.addPage(); y = 50; }

      doc.fontSize(13).font('Helvetica-Bold').fillColor(charcoal)
        .text(dayKey.replace('_', ' ').toUpperCase() + ' — ' + (day.focus || ''), 50, y);
      y += 20;

      (day.exercises || []).forEach(function (ex) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fontSize(10).font('Helvetica').fillColor('#333333')
          .text(ex.name + '  |  ' + ex.sets + ' x ' + ex.reps + '  |  Rest: ' + (ex.rest || '60s'), 70, y);
        if (ex.notes) {
          y += 14;
          doc.fontSize(9).fillColor('#666666').text('   ' + ex.notes, 70, y);
        }
        y += 16;
      });
      y += 10;
    });

    if (y > 600) { doc.addPage(); y = 50; }

    doc.fontSize(18).font('Helvetica-Bold').fillColor(gold)
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    var np = plan.nutrition_plan || {};
    doc.fontSize(11).font('Helvetica-Bold').fillColor(charcoal)
      .text('Daily Targets: ' + (np.calories || '?') + ' cal | ' +
        (np.protein_g || '?') + 'g protein | ' +
        (np.carbs_g || '?') + 'g carbs | ' +
        (np.fats_g || '?') + 'g fats', 50, y);
    y += 25;

    (np.meals || []).forEach(function (meal) {
      if (y > 720) { doc.addPage(); y = 50; }
      doc.fontSize(11).font('Helvetica-Bold').fillColor(charcoal)
        .text(meal.meal + ' (' + (meal.time || '') + ')', 50, y);
      y += 15;
      doc.fontSize(10).font('Helvetica').fillColor('#333333')
        .text(meal.foods || '', 70, y, { width: 460 });
      y += doc.heightOfString(meal.foods || '', { width: 460 }) + 8;
    });

    if (np.supplements && np.supplements.length > 0) {
      y += 10;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(charcoal)
        .text('Supplements: ' + np.supplements.join(', '), 50, y);
      y += 20;
    }

    if (np.hydration) {
      doc.fontSize(10).font('Helvetica').fillColor('#333333')
        .text('Hydration: ' + np.hydration, 50, y);
      y += 20;
    }

    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill(charcoal);
    doc.fillColor(gold).fontSize(9).font('Helvetica')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 28);

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var supabase = getSupabase();
    var b = req.body;

    if (!b.client_id || !b.week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    var clientRes = await supabase.from('clients').select('*').eq('id', b.client_id).single();
    if (!clientRes.data) return res.status(404).json({ error: 'Client not found' });

    var client = clientRes.data;
    var weekNo = parseInt(b.week_no);

    var intakeRes = await supabase.from('intake_data')
      .select('*').eq('lead_id', client.lead_id).single();

    var checkinsRes = await supabase.from('checkins')
      .select('*')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    var context = buildContext(client, intakeRes.data, checkinsRes.data || []);

    var anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    var response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: PROGRAM_PROMPT + '\n\nWeek: ' + weekNo + '\n\n' + context
      }]
    });

    var text = response.content[0].text;
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    var plan;
    try {
      plan = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Invalid JSON from AI' });
    }

    var validationError = validatePlan(plan);
    if (validationError) {
      var whatsapp = require('./_lib/whatsapp');
      var { notifyMaddy } = require('./_lib/escalation');
      var { maskPhone } = require('./_lib/mask');
      await notifyMaddy(supabase, whatsapp, {
        type: 'program_safety',
        summary: validationError + ' for ' + (client.name || 'client') + ' week ' + weekNo,
        phone_masked: maskPhone(client.phone)
      });
      return res.status(400).json({ error: 'Plan flagged for review', reason: validationError });
    }

    var pdfUrl = await generatePdf(supabase, client.id, weekNo, plan, client.name);

    await supabase.from('programs').upsert({
      client_id: client.id,
      week_no: weekNo,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: b.notes || null
    }, { onConflict: 'client_id,week_no' });

    await sendMediaTemplate(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(weekNo)],
      pdfUrl
    );

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client.id)
      .eq('week_no', weekNo);

    return res.status(200).json({
      status: 'ok',
      week: weekNo,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
