// routes/admin.js
const express = require("express");
const crypto = require("crypto");
module.exports = (db) => {
  const router = express.Router();

  // middleware: require login & admin
  router.use((req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "admin") return res.status(403).send("Forbidden");
    next();
  });

  // list users
  router.get("/users", (req, res) => {
    db.all("SELECT id, username, email, role, apikey FROM users", [], (err, rows) => {
      res.render("layouts/dashboard", { title: "Manage Users", user: req.session.user, body: `<div class="cardx p-3"><h5>Users</h5><pre>${JSON.stringify(rows, null, 2)}</pre></div>` });
    });
  });

  // regenerate apikey
  router.post("/users/:id/apikey", (req, res) => {
    const id = req.params.id;
    const newKey = crypto.randomBytes(24).toString("hex");
    db.run("UPDATE users SET apikey = ? WHERE id = ?", [newKey, id], function (err) {
      if (err) return res.json({ error: err.message });
      return res.json({ ok: true, apikey: newKey });
    });
  });

  // create user
  router.post("/users", (req, res) => {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: "Incomplete" });
    const bcrypt = require("bcryptjs");
    const hashed = bcrypt.hashSync(password, 10);
    const apikey = require("crypto").randomBytes(24).toString("hex");
    db.run("INSERT INTO users (username,email,password,role,apikey) VALUES (?,?,?,?,?)", [username, email, hashed, role || "user", apikey], function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ ok: true, id: this.lastID });
    });
  });

  // delete user
  router.delete("/users/:id", (req, res) => {
    const id = req.params.id;
    db.run("DELETE FROM users WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    });
  });

  return router;
};
