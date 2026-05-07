const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*cal/i, /extreme\s*cut/i,
  /clenbuterol/i, /dnp/i, /ephedra/i, /steroid/i,
  /lose\s*\d+\s*kg\s*in\s*\d+\s*day/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic();
    const prompt = buildPrompt(client, recentCheckins || [], prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    if (isFlagged(content)) {
      const { getSupabase: getDb } = require('./lib/supabase');
      const { escalate } = require('./lib/escalation');
      await escalate(
        client.phone,
        'Unsafe program content flagged',
        `Week ${week_no} program for client ${client_id} contained potentially unsafe content. Halted for review.`
      );
      return res.status(200).json({ flagged: true, message: 'Content flagged for Maddy review' });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
      }
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const fileName = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(fileName);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || fileName,
      workout_plan: parsed.workout_plan || parsed.workouts || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || null
    }).select().single();

    const weekNote = parsed.notes || `Week ${week_no} program is ready!`;
    await sendWhatsApp({
      phone: client.phone,
      body: `💪 Week ${week_no} Program Ready!\n\n${weekNote}\n\n📄 Your plan: ${publicUrl?.publicUrl || 'Check your client folder'}`
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, programId: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

WEEK: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

${prevProgram ? `PREVIOUS WEEK PLAN SUMMARY:
Workout: ${JSON.stringify(prevProgram.workout_plan).slice(0, 500)}
Nutrition: ${JSON.stringify(prevProgram.nutrition_plan).slice(0, 500)}
Notes: ${prevProgram.notes || 'None'}` : ''}

Generate a complete weekly program in JSON format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] },
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": ...,
    "protein_g": ...,
    "carbs_g": ...,
    "fats_g": ...,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] },
      ...
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "One-liner context note for the client (warm, encouraging)"
}

RULES:
- Be progressive: adjust based on check-in data
- Never recommend extreme calorie deficits (min 1200 cal for women, 1500 for men)
- Never recommend banned substances
- Keep realistic timelines
- If injuries noted, provide modifications
- Diet-appropriate meals (vegetarian, vegan, halal as needed)`;
}

function isFlagged(content) {
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  return false;
}

async function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#D4AF7A')
      .text(`${client.name || 'Client'} · ${programLabel(client.program)}`, 50, 95, { align: 'center' });

    doc.moveDown(4);

    if (plan.workout_plan?.days) {
      doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', { underline: true });
      doc.moveDown(0.5);

      for (const day of plan.workout_plan.days) {
        doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus || ''}`);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C')
              .text(`  • ${ex.name}: ${ex.sets} × ${ex.reps} (Rest: ${ex.rest || '60s'})${ex.notes ? ' — ' + ex.notes : ''}`, { indent: 20 });
          }
        }
        doc.moveDown(0.3);
      }

      if (plan.workout_plan.cardio) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill('#2C2C2C').text(`Cardio: ${plan.workout_plan.cardio}`);
      }
    }

    doc.moveDown(1);

    if (plan.nutrition_plan) {
      doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', { underline: true });
      doc.moveDown(0.5);

      const np = plan.nutrition_plan;
      if (np.calories) {
        doc.fontSize(11).fill('#2C2C2C')
          .text(`Daily Target: ${np.calories} cal · ${np.protein_g || '?'}g protein · ${np.carbs_g || '?'}g carbs · ${np.fats_g || '?'}g fats`);
      }

      if (np.meals) {
        doc.moveDown(0.5);
        for (const meal of np.meals) {
          doc.fontSize(12).fill('#B8965A').text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#2C2C2C').text(`  • ${opt}`, { indent: 20 });
            }
          }
          doc.moveDown(0.2);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.3);
        doc.fontSize(10).fill('#2C2C2C').text(`Hydration: ${np.hydration}`);
      }
    }

    if (plan.notes) {
      doc.moveDown(1);
      doc.rect(50, doc.y, doc.page.width - 100, 40).fill('#FAF8F4');
      doc.fontSize(11).fill('#2C2C2C').text(plan.notes, 60, doc.y - 30, {
        width: doc.page.width - 120, align: 'center'
      });
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#6B6B6B')
      .text('© Fitness by Maddy · fitnessbymaddy.com · This plan is personalized — do not share.', { align: 'center' });

    doc.end();
  });
}

function programLabel(program) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return labels[program] || program;
}
