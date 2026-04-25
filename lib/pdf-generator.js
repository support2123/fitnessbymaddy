const PDFDocument = require("pdfkit");

const BLACK = "#000000";
const GOLD = "#B8965A";
const WHITE = "#FFFFFF";
const LIGHT_GRAY = "#F5F5F5";
const DARK_GRAY = "#333333";

function formatDate() {
  return new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width;
      const margin = 50;
      const contentWidth = pageWidth - margin * 2;

      doc.rect(0, 0, pageWidth, 140).fill(BLACK);
      doc
        .font("Helvetica-Bold")
        .fontSize(32)
        .fillColor(GOLD)
        .text(`WEEK ${weekNo} PROGRAM`, margin, 40, {
          width: contentWidth,
          align: "center",
        });
      doc
        .font("Helvetica")
        .fontSize(14)
        .fillColor(WHITE)
        .text(client.name || "Client", margin, 85, {
          width: contentWidth,
          align: "center",
        });
      doc.fontSize(11).fillColor(GOLD).text(formatDate(), margin, 108, {
        width: contentWidth,
        align: "center",
      });

      let y = 160;

      function sectionHeader(title) {
        doc.rect(margin, y, contentWidth, 30).fill(GOLD);
        doc.font("Helvetica-Bold").fontSize(14).fillColor(WHITE);
        doc.text(title, margin + 10, y + 8);
        y += 40;
      }

      function checkPage(needed) {
        if (y + needed > doc.page.height - 60) {
          doc.addPage();
          y = 50;
        }
      }

      if (plan.workout_plan && plan.workout_plan.days) {
        sectionHeader("WORKOUT PLAN");

        for (const day of plan.workout_plan.days) {
          checkPage(80);

          doc.font("Helvetica-Bold").fontSize(12).fillColor(DARK_GRAY);
          doc.text(`${day.day} — ${day.focus || ""}`, margin, y);
          y += 18;

          if (day.exercises) {
            doc.rect(margin, y, contentWidth, 20).fill(LIGHT_GRAY);
            doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK_GRAY);
            doc.text("Exercise", margin + 5, y + 5, { width: 200 });
            doc.text("Sets", margin + 220, y + 5, { width: 50 });
            doc.text("Reps", margin + 280, y + 5, { width: 80 });
            doc.text("Rest", margin + 370, y + 5, { width: 80 });
            y += 22;

            for (const ex of day.exercises) {
              checkPage(20);
              doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY);
              doc.text(ex.name || "", margin + 5, y + 2, { width: 200 });
              doc.text(String(ex.sets || ""), margin + 220, y + 2, { width: 50 });
              doc.text(String(ex.reps || ""), margin + 280, y + 2, { width: 80 });
              doc.text(String(ex.rest || ""), margin + 370, y + 2, { width: 80 });
              y += 18;
            }
          }

          y += 10;
        }
      }

      if (plan.nutrition_plan) {
        checkPage(100);
        sectionHeader("NUTRITION PLAN");

        doc.font("Helvetica-Bold").fontSize(11).fillColor(DARK_GRAY);
        const cals = plan.nutrition_plan.calories || "N/A";
        const protein = plan.nutrition_plan.protein || "N/A";
        doc.text(`Daily Target: ${cals} calories | ${protein}g protein`, margin, y);
        y += 25;

        if (plan.nutrition_plan.meals) {
          for (const meal of plan.nutrition_plan.meals) {
            checkPage(40);
            doc.font("Helvetica-Bold").fontSize(10).fillColor(GOLD);
            doc.text(meal.meal || "", margin, y);
            y += 15;
            doc.font("Helvetica").fontSize(10).fillColor(DARK_GRAY);
            const cal = meal.approx_calories ? ` (~${meal.approx_calories} cal)` : "";
            doc.text(`${meal.suggestion || ""}${cal}`, margin + 10, y, {
              width: contentWidth - 10,
            });
            y += 18;
          }
        }
      }

      if (plan.notes) {
        checkPage(80);
        y += 10;
        sectionHeader("NOTES");
        doc.font("Helvetica").fontSize(10).fillColor(DARK_GRAY);
        doc.text(plan.notes, margin, y, { width: contentWidth });
        y += 20;
      }

      const footerY = doc.page.height - 40;
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(GOLD)
        .text("FitnessByMaddy | fitnessbymaddy.com", margin, footerY, {
          width: contentWidth,
          align: "center",
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generatePDF };
