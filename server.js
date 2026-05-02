require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// ── SERVE FRONTEND ──
app.use(express.static("public"));

// ── DATABASE ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("✅ PostgreSQL Connected"))
  .catch(err => console.error("❌ DB Connection Error:", err));


// ============================================================
// AUTO-CREATE TABLES ON STARTUP
// Run once — safe to leave in, uses IF NOT EXISTS
// ============================================================
async function initDB() {
  try {
    // Main session entries table — fully synced with index.html payload
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session_entries (
        id              SERIAL PRIMARY KEY,
        educator_name   TEXT,
        yellow_room     TEXT,
        level           TEXT,
        batch           TEXT,
        subject         TEXT,
        chapter_name    TEXT,
        index_code      TEXT,
        lesson          TEXT,
        session_date    DATE,
        slot_number     INT,
        submitted_at    TIMESTAMPTZ,   -- silent capture, never shown to educator
        is_late         BOOLEAN        -- silent flag, never shown to educator
      )
    `);

    // Lesson codes table — for future dynamic chapter/index/lesson loading
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_codes (
        id                  SERIAL PRIMARY KEY,
        batch               TEXT,
        subject             TEXT,
        chapter_name        TEXT,
        index_code          TEXT UNIQUE,
        lesson_plan_title   TEXT
      )
    `);

    // Yellow rooms reference table — used by PC dashboard
    await pool.query(`
      CREATE TABLE IF NOT EXISTS yellow_rooms (
        id          SERIAL PRIMARY KEY,
        yellow_room TEXT UNIQUE
      )
    `);

    // Timetable table — for future backend-driven timetable loading
    await pool.query(`
      CREATE TABLE IF NOT EXISTS yellow_room_timetable (
        id          SERIAL PRIMARY KEY,
        week_number INT,
        day_number  INT,
        batch       TEXT,
        subject     TEXT,
        slot_number INT
      )
    `);

    console.log("✅ All tables ready");
  } catch (err) {
    console.error("❌ Table init error:", err);
  }
}

initDB();


// ============================================================
// API HEALTH CHECK
// ============================================================
app.get("/api", (req, res) => {
  res.json({ status: "LP.MIS API is running" });
});


// ============================================================
// SAVE SESSION ENTRY
// POST /add-session
// Called by index.html on Save Full Day
// Receives full payload including silent fields
// ============================================================
app.post("/add-session", async (req, res) => {
  try {
    const {
      educator_name,
      yellow_room,
      level,
      batch,
      subject,
      chapter_name,
      index_code,
      lesson,
      session_date,
      slot_number,
      _submitted_at,   // silent — from index.html, not shown to educator
      _is_late         // silent — from index.html, not shown to educator
    } = req.body;

    await pool.query(`
      INSERT INTO session_entries
        (educator_name, yellow_room, level, batch, subject,
         chapter_name, index_code, lesson, session_date,
         slot_number, submitted_at, is_late)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      educator_name,
      yellow_room,
      level,
      batch,
      subject,
      chapter_name  || "NA",
      index_code    || "NA",
      lesson        || "NA",
      session_date,
      slot_number,
      _submitted_at || new Date().toISOString(),
      _is_late      || false
    ]);

    res.json({ message: "saved" });

  } catch (err) {
    console.error("❌ /add-session error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ============================================================
// GET CHAPTERS
// GET /chapters/:batch/:subject
// Used when you move subjectData to DB (next step)
// ============================================================
app.get("/chapters/:batch/:subject", async (req, res) => {
  try {
    const { batch, subject } = req.params;
    const result = await pool.query(`
      SELECT DISTINCT chapter_name
      FROM lesson_codes
      WHERE batch = $1 AND subject = $2
      ORDER BY chapter_name
    `, [batch, subject]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// ============================================================
// GET INDEX CODES
// GET /indexes/:batch/:subject/:chapter
// ============================================================
app.get("/indexes/:batch/:subject/:chapter", async (req, res) => {
  try {
    const { batch, subject, chapter } = req.params;
    const result = await pool.query(`
      SELECT index_code
      FROM lesson_codes
      WHERE batch = $1 AND subject = $2 AND chapter_name = $3
      ORDER BY index_code
    `, [batch, subject, chapter]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// ============================================================
// GET LESSON TITLE BY INDEX CODE
// GET /lesson/:code
// ============================================================
app.get("/lesson/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query(`
      SELECT lesson_plan_title
      FROM lesson_codes
      WHERE index_code = $1
    `, [code]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lesson not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// ============================================================
// GET TIMETABLE BY WEEK + DAY
// GET /day-plan/:week/:day
// Ready for when you move timetables to DB
// ============================================================
app.get("/day-plan/:week/:day", async (req, res) => {
  try {
    const { week, day } = req.params;
    const result = await pool.query(`
      SELECT *
      FROM yellow_room_timetable
      WHERE week_number = $1 AND day_number = $2
      ORDER BY batch, slot_number
    `, [week, day]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// ============================================================
// PC DASHBOARD DATA
// GET /pc-dashboard-data?date=YYYY-MM-DD
// Returns submission status per room for a given date
// Includes late submission detection
// ============================================================
app.get("/pc-dashboard-data", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const selectedDate = req.query.date || today;

    const result = await pool.query(`
      SELECT
        y.yellow_room,
        TO_CHAR($1::date, 'DD-MM-YYYY')   AS date,
        COUNT(s.id)                         AS sessions_logged,
        MAX(s.submitted_at)                 AS last_submitted_at,
        BOOL_OR(s.is_late)                  AS has_late_submission,

        CASE
          WHEN COUNT(s.id) = 0  THEN 'Missing'
          WHEN COUNT(s.id) < 8  THEN 'Partial'
          ELSE 'Complete'
        END AS status

      FROM yellow_rooms y

      LEFT JOIN session_entries s
        ON y.yellow_room = s.yellow_room
        AND s.session_date = $1::date

      GROUP BY y.yellow_room
      ORDER BY y.yellow_room
    `, [selectedDate]);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// ============================================================
// GET ALL SESSIONS FOR A ROOM + DATE
// GET /sessions?room=Malhaur&date=2025-05-02
// Useful for reviewing what was submitted
// ============================================================
app.get("/sessions", async (req, res) => {
  try {
    const { room, date } = req.query;
    if (!room || !date) {
      return res.status(400).json({ error: "room and date are required" });
    }

    const result = await pool.query(`
      SELECT
        id, educator_name, batch, subject,
        chapter_name, index_code, lesson,
        slot_number, session_date,
        submitted_at, is_late
      FROM session_entries
      WHERE yellow_room = $1 AND session_date = $2
      ORDER BY batch, slot_number
    `, [room, date]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// ============================================================
// GET LATE SUBMISSION REPORT
// GET /late-submissions?from=YYYY-MM-DD&to=YYYY-MM-DD
// Coordinator-only view — educators never see this
// ============================================================
app.get("/late-submissions", async (req, res) => {
  try {
    const { from, to } = req.query;
    const result = await pool.query(`
      SELECT
        yellow_room, educator_name, session_date,
        submitted_at, COUNT(*) AS entries
      FROM session_entries
      WHERE is_late = true
        AND ($1::date IS NULL OR session_date >= $1::date)
        AND ($2::date IS NULL OR session_date <= $2::date)
      GROUP BY yellow_room, educator_name, session_date, submitted_at
      ORDER BY session_date DESC
    `, [from || null, to || null]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 LP.MIS Server running on port ${PORT}`);
});