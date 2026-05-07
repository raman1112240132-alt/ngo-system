require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// ============================================================
// SERVE FRONTEND
// ============================================================
app.use(express.static("public"));


// ============================================================
// DATABASE
// ============================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("✅ PostgreSQL Connected"))
  .catch(err => console.error("❌ DB Connection Error:", err));


// ============================================================
// EXPECTED SESSIONS CONFIG
// ============================================================
const expectedSessions = {

  Tenderfeet: [
    "EVS",
    "Maths",
    "FN",
    "Linguistic",
    "Naitik Shiksha",
    "SEL Plans",
    "Yoga",
    "Games",
    "Drawing",
    "Cleanliness"
  ],

  Learners: [
    "Science",
    "Maths",
    "FN",
    "Linguistic",
    "WHY",
    "General Awareness",
    "Naitik Shiksha",
    "SEL Plans",
    "Yoga",
    "Games",
    "Drawing",
    "Cleanliness"
  ],

  Advancers: [
    "Science",
    "Maths",
    "FN",
    "Linguistic",
    "WHY",
    "General Awareness",
    "Naitik Shiksha",
    "SEL Plans",
    "Yoga",
    "Games",
    "Drawing",
    "Cleanliness"
  ],

  Aspirers: [
    "Science",
    "Maths",
    "FN",
    "Linguistic",
    "WHY",
    "General Awareness",
    "Naitik Shiksha",
    "SEL Plans",
    "Yoga",
    "Games",
    "Drawing",
    "Cleanliness"
  ]

};


// ============================================================
// AUTO CREATE TABLES
// ============================================================
async function initDB() {

  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS session_entries (
        id SERIAL PRIMARY KEY,
        educator_name TEXT,
        yellow_room TEXT,
        level TEXT,
        batch TEXT,
        subject TEXT,
        chapter_name TEXT,
        index_code TEXT,
        lesson TEXT,
        session_date DATE,
        slot_number INT,
        submitted_at TIMESTAMPTZ,
        is_late BOOLEAN,
        delay_days INT,
        is_incomplete BOOLEAN
      )
    `);

    console.log("✅ Tables Ready");

  } catch(err){

    console.log(err);

  }

}

initDB();


// ============================================================
// HOME ROUTE
// ============================================================
app.get('/',(req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});


// ============================================================
// DASHBOARD ROUTE
// ============================================================
app.get('/dashboard',(req,res)=>{
  res.sendFile(path.join(__dirname,'public','pc-dashboard.html'));
});


// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api',(req,res)=>{
  res.json({status:'LP.MIS API running'});
});


// ============================================================
// SAVE SESSION
// ============================================================
app.post('/add-session', async(req,res)=>{

  try{

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
      submitted_at,
      is_late,
      delay_days,
      is_incomplete
    } = req.body;


    await pool.query(`
      INSERT INTO session_entries(
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
        submitted_at,
        is_late,
        delay_days,
        is_incomplete
      )
      VALUES(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      )
    `,[
      educator_name,
      yellow_room,
      level,
      batch,
      subject,
      chapter_name || 'NA',
      index_code || 'NA',
      lesson || 'NA',
      session_date,
      slot_number,
      submitted_at || new Date().toISOString(),
      is_late || false,
      delay_days || 0,
      is_incomplete || false
    ]);


    res.json({message:'Saved'});

  }catch(err){

    console.log(err);

    res.status(500).json({error:'Save Error'});

  }

});


// ============================================================
// MONTHLY DASHBOARD API
// ============================================================
app.get('/dashboard/month', async(req,res)=>{

  try{

    const month = req.query.month;
    const room = req.query.room || 'ALL';

    const start = `${month}-01`;

    const end = `${month}-31`;

    const result = await pool.query(`
  SELECT *
  FROM session_entries
  WHERE session_date BETWEEN $1 AND $2
  AND ($3 = 'ALL' OR yellow_room = $3)
`,[start,end,room]);

    const rows = result.rows;

    const totalSessions = rows.length;

    const lateCount = rows.filter(r=>r.is_late).length;

    const incompleteCount = rows.filter(r=>r.is_incomplete).length;


    // ============================================================
    // ROOM PERFORMANCE
    // ============================================================
    const roomBatchMap = {};

    rows.forEach(r=>{

      const key = `${r.yellow_room}_${r.batch}`;

      if(!roomBatchMap[key]){
        roomBatchMap[key] = {
          room:r.yellow_room,
          batch:r.batch,
          subjects:[]
        };
      }

      roomBatchMap[key].subjects.push(r.subject);

    });


    const rooms = [];

    Object.keys(roomBatchMap).forEach(key=>{

      const data = roomBatchMap[key];

      const expected = expectedSessions[data.batch] || [];

      const completed = expected.filter(s=>
        data.subjects.includes(s)
      );

      const missing = expected.filter(s=>
        !data.subjects.includes(s)
      );

      const completion = Math.round(
        (completed.length / expected.length) * 100
      );

      rooms.push({
        name:data.room,
        batch:data.batch,
        completion,
        missing
      });

    });


    const completeRooms = rooms.filter(r=>r.completion===100).length;


    // ============================================================
    // SUBJECT COVERAGE
    // ============================================================
    const subjectMap = {};

    rows.forEach(r=>{

      if(!subjectMap[r.subject]){
        subjectMap[r.subject] = 0;
      }

      subjectMap[r.subject]++;

    });


    const subjectCoverage = Object.keys(subjectMap).map(k=>({
      subject:k,
      percent:subjectMap[k]
    }));


    // ============================================================
    // PROGRAM ACTIVITIES
    // ============================================================
    const activities = [

      {
        name:'PTM',
        expected:'1/month',
        conducted:rows.filter(r=>r.subject==='PTM').length,
        status:rows.filter(r=>r.subject==='PTM').length>0 ? 'Completed':'Pending'
      },

      {
        name:'Padho Padhao',
        expected:'4/month',
        conducted:rows.filter(r=>r.subject==='Padho Padhao').length,
        status:rows.filter(r=>r.subject==='Padho Padhao').length>=4 ? 'Completed':'Pending'
      },

      {
        name:'Children Panchayat',
        expected:'1/month',
        conducted:rows.filter(r=>r.subject==='Children Panchayat').length,
        status:rows.filter(r=>r.subject==='Children Panchayat').length>0 ? 'Completed':'Pending'
      },

      {
        name:'Animal Management',
        expected:'4/month',
        conducted:rows.filter(r=>r.subject==='Animal Management').length,
        status:rows.filter(r=>r.subject==='Animal Management').length>=4 ? 'Completed':'Pending'
      }

    ];


    res.json({
      totalSessions,
      lateCount,
      incompleteCount,
      completeRooms,
      rooms,
      subjectCoverage,
      activities
    });

  }catch(err){

    console.log(err);

    res.status(500).json({error:'Dashboard Error'});

  }

});

// ============================================================
// RAW SESSION API
// ============================================================
app.get('/api/sessions/raw', async(req,res)=>{

  try{

    const month = req.query.month;
    const toMonth = req.query.toMonth || month;
    const room = req.query.room || 'ALL';

    const start = `${month}-01`;

    const endDate = new Date(`${toMonth}-01`);

    endDate.setMonth(endDate.getMonth()+1);

    const end = endDate.toISOString().slice(0,10);

    const result = await pool.query(`
      SELECT
        id,
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
        submitted_at,
        is_late,
        delay_days,
        is_incomplete
      FROM session_entries
      WHERE session_date >= $1
      AND session_date < $2
      AND ($3='ALL' OR yellow_room=$3)
      ORDER BY session_date ASC, slot_number ASC
    `,[start,end,room]);

    res.json(result.rows);

  }catch(err){

    console.log(err);

    res.status(500).json({
      error:'Raw fetch error'
    });

  }

});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 10000;

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`🚀 Server Running on ${PORT}`);
});

