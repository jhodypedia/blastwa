// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
module.exports = (db) => {
  const router = express.Router();

  router.get("/login", (req, res) => res.render("auth/login", { error: null }));
  router.get("/register", (req, res) => res.render("auth/register", { error: null }));

  router.post("/register", async (req, res) => {
    try {
      const { username, email, password } = req.body;
      if (!username || !email || !password) return res.render("auth/register", { error: "Lengkapi semua field" });
      const hashed = await bcrypt.hash(password, 10);
      const apikey = crypto.randomBytes(24).toString("hex");
      db.run("INSERT INTO users (username,email,password,role,apikey) VALUES (?,?,?,?,?)",
        [username, email, hashed, "user", apikey], function (err) {
          if (err) return res.render("auth/register", { error: "Username/Email sudah digunakan" });
          return res.redirect("/login");
        });
    } catch (e) {
      return res.render("auth/register", { error: "Error" });
    }
  });

  router.post("/login", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.render("auth/login", { error: "Isi email & password" });
    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
      if (err || !user) return res.render("auth/login", { error: "User tidak ditemukan" });
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.render("auth/login", { error: "Password salah" });
      // set session (don't include password)
      req.session.user = { id: user.id, username: user.username, email: user.email, role: user.role, apikey: user.apikey };
      return res.redirect("/wa/setup");
    });
  });

  router.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
  });

  return router;
};
