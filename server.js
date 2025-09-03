// server.js
const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const fs = require("fs");
const cors = require("cors");

const app = express();
const dbFile = path.join(__dirname, "db.sqlite");
const db = new sqlite3.Database(dbFile);

// create folders
if (!fs.existsSync(path.join(__dirname, "uploads"))) fs.mkdirSync(path.join(__dirname, "uploads"));
if (!fs.existsSync(path.join(__dirname, "session"))) fs.mkdirSync(path.join(__dirname, "session"));

// create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user',
    apikey TEXT UNIQUE
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    number TEXT,
    type TEXT,
    status TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    content TEXT
  )`);
});

// view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// session
app.use(session({
  secret: "replace_with_a_strong_secret",
  resave: false,
  saveUninitialized: false
}));

// mount routers
const authRouter = require("./routes/auth")(db);
const waRouter = require("./routes/wa")(db);
const adminRouter = require("./routes/admin")(db);

app.use("/", authRouter);            // /login /register etc
app.use("/wa", waRouter);            // protected WA endpoints and pages
app.use("/admin", adminRouter);      // admin-only routes

// landing
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  return res.redirect("/wa/setup");
});

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
