const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'under 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: profile } = await supabase
      .from('lead_profiles')
      .select('*')
      .eq('lead_id', client.lead_id)
      .maybeSingle();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create personalized weekly workout and nutrition plans.

RULES:
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned or dangerous substances
- Never make unrealistic timeline promises
- Base plans on evidence-based exercise science
- Consider injuries, limitations, and medical conditions
- Progressive overload principle for strength training
- Periodization across the program weeks

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_focus": "...",
  "coach_note": "..."
}`;

    const userPrompt = buildUserPrompt(client, profile, recentCheckins, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy(client.phone, 'Program generation failed - invalid JSON response');
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    let programData;
    try {
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      await escalateToMaddy(client.phone, 'Program generation failed - JSON parse error');
      return res.status(500).json({ error: 'Invalid JSON in response' });
    }

    const responseStr = JSON.stringify(programData).toLowerCase();
    const safetyIssue = SAFETY_FLAGS.find(flag => responseStr.includes(flag));
    if (safetyIssue) {
      await escalateToMaddy(
        client.phone,
        `Safety flag: "${safetyIssue}" detected in generated program for week ${week_no}`
      );
      return res.status(200).json({ flagged: true, reason: safetyIssue });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const pdfPath = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const { error: insertError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        generated_at: new Date().toISOString(),
        pdf_url: publicUrl?.publicUrl || null,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note || null,
      });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
    }

    const market = detectMarket(client.phone);
    const note = programData.weekly_focus || `Week ${week_no} program`;
    const params = isHinglish(market)
      ? [`Week ${week_no}`, note, publicUrl?.publicUrl || '']
      : [`Week ${week_no}`, note, publicUrl?.publicUrl || ''];
    await sendTemplate(client.phone, 'weekly_program', params);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({
      success: true,
      clientId: client_id,
      weekNo: week_no,
      pdfUrl: publicUrl?.publicUrl,
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildUserPrompt(client, profile, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for client:\n`;
  prompt += `- Name: ${client.name || 'Client'}\n`;
  prompt += `- Program: ${client.program}\n`;

  if (profile) {
    if (profile.age) prompt += `- Age: ${profile.age}\n`;
    if (profile.gender) prompt += `- Gender: ${profile.gender}\n`;
    if (profile.goal) prompt += `- Goal: ${profile.goal}\n`;
    if (profile.injuries) prompt += `- Injuries/Limitations: ${profile.injuries}\n`;
    if (profile.diet_preference) prompt += `- Diet Preference: ${profile.diet_preference}\n`;
    if (profile.current_weight) prompt += `- Current Weight: ${profile.current_weight}kg\n`;
    if (profile.target_weight) prompt += `- Target Weight: ${profile.target_weight}kg\n`;
    if (profile.experience_level) prompt += `- Experience: ${profile.experience_level}\n`;
    if (profile.schedule) prompt += `- Schedule: ${profile.schedule}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `Week ${c.week_no}: weight=${c.weight || '?'}kg, waist=${c.waist || '?'}cm, `;
      prompt += `compliance=${c.compliance_score || '?'}/10, energy=${c.energy || '?'}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      if (c.next_week_focus) prompt += `, focus: ${c.next_week_focus}`;
      prompt += `\n`;
    }
  }

  if (weekNo > 1) {
    prompt += `\nThis is week ${weekNo}, so apply progressive overload from the previous week. `;
    prompt += `Adjust based on check-in data above.`;
  }

  return prompt;
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Week ${weekNo} Program - ${client.name || 'Client'}`,
        Author: 'Fitness by Maddy',
      },
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A')
      .fontSize(28)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fill('#FFFFFF')
      .fontSize(14)
      .font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 72, { align: 'left' });
    doc.fill('#D4AF7A')
      .fontSize(10)
      .text(client.name ? client.name.toUpperCase() : 'CLIENT', 50, 92, { align: 'left' });

    doc.moveDown(3);

    if (programData.weekly_focus) {
      doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold').text('WEEKLY FOCUS');
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica').text(programData.weekly_focus);
      doc.moveDown(1);
    }

    if (programData.workout_plan) {
      doc.fill('#2C2C2C').fontSize(16).font('Helvetica-Bold').text('WORKOUT PLAN');
      doc.moveDown(0.5);

      const wp = programData.workout_plan;
      if (wp.days) {
        for (const day of wp.days) {
          doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold')
            .text(`${day.day} — ${day.focus || ''}`);
          doc.moveDown(0.3);

          if (day.exercises) {
            for (const ex of day.exercises) {
              const line = `  ${ex.name} — ${ex.sets} x ${ex.reps}` +
                (ex.rest ? ` (rest: ${ex.rest})` : '') +
                (ex.notes ? ` [${ex.notes}]` : '');
              doc.fill('#2C2C2C').fontSize(9).font('Helvetica').text(line);
            }
          }
          doc.moveDown(0.5);
        }
      }

      if (wp.cardio) {
        doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold').text('CARDIO');
        doc.fill('#2C2C2C').fontSize(9).font('Helvetica').text(wp.cardio);
        doc.moveDown(0.5);
      }
    }

    if (programData.nutrition_plan) {
      if (doc.y > 600) doc.addPage();
      doc.moveDown(1);
      doc.fill('#2C2C2C').fontSize(16).font('Helvetica-Bold').text('NUTRITION PLAN');
      doc.moveDown(0.5);

      const np = programData.nutrition_plan;
      doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold').text('DAILY TARGETS');
      doc.fill('#2C2C2C').fontSize(9).font('Helvetica')
        .text(`Calories: ${np.calories || '—'} kcal  |  Protein: ${np.protein_g || '—'}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fats: ${np.fats_g || '—'}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold').text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill('#2C2C2C').fontSize(9).font('Helvetica').text(`  • ${opt}`);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.supplements && np.supplements.length) {
        doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold').text('SUPPLEMENTS');
        for (const s of np.supplements) {
          doc.fill('#2C2C2C').fontSize(9).font('Helvetica').text(`  • ${s}`);
        }
        doc.moveDown(0.5);
      }

      if (np.hydration) {
        doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold').text('HYDRATION');
        doc.fill('#2C2C2C').fontSize(9).font('Helvetica').text(np.hydration);
      }
    }

    if (programData.coach_note) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(1.5);
      doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold').text("MADDY'S NOTE");
      doc.fill('#2C2C2C').fontSize(9).font('Helvetica').text(programData.coach_note);
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fill('#AAAAAA').fontSize(8).font('Helvetica')
        .text(
          'fitnessbymaddy.com | Confidential',
          50,
          doc.page.height - 30,
          { align: 'center', width: doc.page.width - 100 }
        );
    }

    doc.end();
  });
}
