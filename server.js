require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
.then(()=>console.log("PostgreSQL Connected"))
.catch(err=>console.error(err));


// =============================
// GET CHAPTERS
// =============================
app.get("/chapters/:batch/:subject", async (req,res)=>{

const {batch,subject}=req.params;

const result=await pool.query(
`
SELECT DISTINCT chapter_name
FROM lesson_codes
WHERE batch=$1 AND subject=$2
ORDER BY chapter_name
`,
[batch,subject]
);

res.json(result.rows);

});


// =============================
// GET INDEX CODES
// =============================
app.get("/indexes/:batch/:subject/:chapter", async (req,res)=>{

const {batch,subject,chapter}=req.params;

const result=await pool.query(
`
SELECT index_code
FROM lesson_codes
WHERE batch=$1
AND subject=$2
AND chapter_name=$3
ORDER BY index_code
`,
[batch,subject,chapter]
);

res.json(result.rows);

});


// =============================
// GET LESSON TITLE
// =============================
app.get("/lesson/:code", async (req,res)=>{

const {code}=req.params;

const result=await pool.query(
`
SELECT lesson_plan_title
FROM lesson_codes
WHERE index_code=$1
`,
[code]
);

res.json(result.rows[0]);

});


// =============================
// GET TIMETABLE
// =============================
app.get("/day-plan/:day", async (req,res)=>{

const {day}=req.params;

const result=await pool.query(
`
SELECT *
FROM yellow_room_timetable
WHERE day_number=$1
ORDER BY batch,slot_number
`,
[day]
);

res.json(result.rows);

});


// =============================
// SAVE SESSION ENTRY
// =============================
app.post("/add-session", async (req,res)=>{

const {
educator_name,
level,
subject,
chapter_name,
index_code,
session_date,
yellow_room,
slot_number
}=req.body;

await pool.query(
`
INSERT INTO session_entries
(educator_name,level,subject,chapter_name,index_code,session_date,yellow_room,slot_number)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
`,
[
educator_name,
level,
subject,
chapter_name,
index_code,
session_date,
yellow_room,
slot_number
]
);

res.json({message:"saved"});

});


// =============================
// PROGRAM COORDINATOR DASHBOARD
// =============================
app.get("/pc-dashboard-data", async (req,res)=>{

try{

const result = await pool.query(`
SELECT 
y.yellow_room,
CURRENT_DATE AS date,
COUNT(s.id) AS sessions_logged,

CASE
WHEN COUNT(s.id) = 0 THEN 'Missing'
WHEN COUNT(s.id) < 8 THEN 'Partial'
ELSE 'Complete'
END AS status

FROM yellow_rooms y

LEFT JOIN session_entries s
ON y.yellow_room = s.yellow_room
AND s.session_date = CURRENT_DATE

GROUP BY y.yellow_room
ORDER BY y.yellow_room
`);

res.json(result.rows);

}catch(error){

console.error(error);
res.status(500).json({error:"Server error"});

}

});


// =============================
// START SERVER
// =============================
const PORT=process.env.PORT||5000;

app.listen(PORT,()=>{
console.log("Server running on port "+PORT);
});