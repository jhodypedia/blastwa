// routes/wa.js
const express = require("express");
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { normalizeNumber } = require("../utils");

const upload = multer({ dest: path.join(__dirname, "..", "uploads") });

module.exports = (db) => {
  const router = express.Router();

  // middleware: require login
  router.use((req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    next();
  });

  // --- Baileys state (single socket for simplicity) ---
  let sock = null;
  let qrString = null;
  let isConnected = false;
  let progress = { total: 0, sent: 0 };
  let cancelFlag = false;

  async function connectWA() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "..", "session"));
      const { version } = await fetchLatestBaileysVersion();
      sock = makeWASocket({ version, auth: state, printQRInTerminal: false });

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) { qrString = qr; isConnected = false; }
        if (connection === "open") { qrString = null; isConnected = true; }
        if (connection === "close") {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) setTimeout(connectWA, 2000);
        }
      });

      sock.ev.on("creds.update", saveCreds);

      // messages.upsert example -> save incoming to logs
      sock.ev.on("messages.upsert", async (m) => {
        try {
          const msgs = m.messages || [];
          for (const msg of msgs) {
            if (!msg.key || !msg.message) continue;
            const from = msg.key.remoteJid || "";
            // store incoming message event to logs table (optional)
            db.run("INSERT INTO logs (user_id, number, type, status, error) VALUES (?,?,?,?,?)",
              [null, from, "incoming", "received", null]);
          }
        } catch (e) { console.error("msg.upsert err", e); }
      });

    } catch (err) {
      console.error("connectWA err", err);
      setTimeout(connectWA, 5000);
    }
  }
  connectWA();

  // render layout helper
  const ejs = require("ejs");
  const layoutPath = path.join(__dirname, "..", "views", "layouts", "dashboard.ejs");
  function renderWithLayout(res, viewName, options = {}) {
    const content = fs.readFileSync(path.join(__dirname, "..", "views", "pages", viewName + ".ejs"), "utf8");
    const layout = fs.readFileSync(layoutPath, "utf8");
    const html = ejs.render(layout, { ...options, body: content });
    res.send(html);
  }

  // pages
  router.get("/setup", (req, res) => renderWithLayout(res, "setup", { title: "Setup WhatsApp", active: "setup", user: req.session.user }));
  router.get("/blast", (req, res) => {
    db.all("SELECT * FROM templates WHERE user_id=? ORDER BY id DESC", [req.session.user.id], (err, templates) => {
      renderWithLayout(res, "blast", { title: "Blast Pesan", active: "blast", user: req.session.user, templates: templates || [] });
    });
  });
  router.get("/logs", (req, res) => {
    db.all("SELECT * FROM logs WHERE user_id=? ORDER BY created_at DESC LIMIT 500", [req.session.user.id], (err, rows) => {
      renderWithLayout(res, "logs", { title: "Logs", active: "logs", user: req.session.user, logs: rows || [] });
    });
  });
  router.get("/templates", (req, res) => {
    db.all("SELECT * FROM templates WHERE user_id=? ORDER BY id DESC", [req.session.user.id], (err, rows) => {
      renderWithLayout(res, "templates", { title: "Templates", active: "templates", user: req.session.user, templates: rows || [] });
    });
  });

  // QR endpoint (frontend polls)
  router.get("/qr", async (req, res) => {
    try {
      if (qrString) {
        const qrimg = await qrcode.toDataURL(qrString);
        return res.json({ qr: qrimg });
      }
      return res.json({ qr: null, connected: isConnected });
    } catch (e) { return res.json({ qr: null, connected: isConnected }); }
  });

  // SSE progress endpoint
  router.get("/progress", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const iv = setInterval(() => {
      res.write(`data: ${JSON.stringify(progress)}\n\n`);
    }, 800);
    req.on("close", () => clearInterval(iv));
  });

  // cancel endpoint (admin or owner)
  router.post("/cancel", (req, res) => {
    // only admin or owner of session - basic check here: allow admin OR same user
    if (req.session.user.role !== "admin") {
      // allow user to cancel their own blast - but we only have single socket; accept if user role user as well
    }
    cancelFlag = true;
    return res.json({ ok: true });
  });

  // API to get contacts
  router.get("/contacts", async (req, res) => {
    try {
      if (!sock) return res.status(500).json({ error: "WA not connected" });
      const contacts = Object.values(sock.store.contacts || {});
      res.json(contacts);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // profile update (status)
  router.post("/profile/status", async (req, res) => {
    try {
      const { status } = req.body;
      if (!sock) return res.status(500).json({ error: "not connected" });
      await sock.updateProfileStatus(status);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Templates API (create/edit/delete)
  router.post("/templates", (req, res) => {
    const { name, content } = req.body;
    db.run("INSERT INTO templates (user_id, name, content) VALUES (?,?,?)", [req.session.user.id, name, content], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, content });
    });
  });

  router.delete("/templates/:id", (req, res) => {
    db.run("DELETE FROM templates WHERE id = ? AND user_id = ?", [req.params.id, req.session.user.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    });
  });

  // Blast endpoint: supports numbers textarea OR file upload, supports optional media upload
  router.post("/blast", upload.fields([{ name: "numbersFile" }, { name: "media" }]), async (req, res) => {
    try {
      const type = req.body.type || "text";
      const text = req.body.text || "";
      let numbers = [];

      // parse file
      if (req.files && req.files["numbersFile"] && req.files["numbersFile"][0]) {
        const content = fs.readFileSync(req.files["numbersFile"][0].path, "utf8");
        numbers = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      } else if (req.body.numbers) {
        numbers = req.body.numbers.split(",").map(n => n.trim()).filter(Boolean);
      }

      if (!numbers.length) return res.status(400).json({ error: "No numbers provided" });

      // initialize progress & cancel flag
      progress = { total: numbers.length, sent: 0 };
      cancelFlag = false;

      const results = [];
      for (const rawNum of numbers) {
        if (cancelFlag) { results.push({ number: rawNum, status: "cancelled" }); continue; }
        let num;
        try {
          num = normalizeNumber(rawNum);
        } catch (err) {
          results.push({ number: rawNum, status: "failed", error: err.message });
          // log
          db.run("INSERT INTO logs (user_id, number, type, status, error) VALUES (?,?,?,?,?)",
            [req.session.user.id, rawNum, type, "failed", err.message]);
          progress.sent++;
          await new Promise(r => setTimeout(r, 200));
          continue;
        }
        const jid = `${num}@s.whatsapp.net`;

        try {
          // handle text
          if (type === "text") {
            await sock.sendMessage(jid, { text });
          }
          // handle media uploaded
          if (type === "media" && req.files && req.files["media"] && req.files["media"][0]) {
            const f = req.files["media"][0];
            const ext = path.extname(f.originalname).toLowerCase();
            if ([".jpg", ".jpeg", ".png"].includes(ext)) {
              await sock.sendMessage(jid, { image: { url: f.path }, caption: text || "" });
            } else if ([".mp4", ".mov"].includes(ext)) {
              await sock.sendMessage(jid, { video: { url: f.path }, caption: text || "" });
            } else {
              await sock.sendMessage(jid, { document: { url: f.path }, fileName: f.originalname, mimetype: f.mimetype });
            }
          }
          // TODO: buttons/list support (can parse req.body.buttons / req.body.list)

          results.push({ number: rawNum, status: "success" });
          db.run("INSERT INTO logs (user_id, number, type, status, error) VALUES (?,?,?,?,?)",
            [req.session.user.id, rawNum, type, "success", null]);
        } catch (err) {
          results.push({ number: rawNum, status: "failed", error: err.message });
          db.run("INSERT INTO logs (user_id, number, type, status, error) VALUES (?,?,?,?,?)",
            [req.session.user.id, rawNum, type, "failed", err.message]);
        }
        progress.sent++;
        // small delay to avoid flooding
        await new Promise(r => setTimeout(r, 300));
      }

      // reset cancel flag after finished
      cancelFlag = false;
      return res.json({ success: true, results });
    } catch (err) {
      console.error("blast error", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // single send message API (via form / external)
  router.post("/message", async (req, res) => {
    try {
      const { to, text } = req.body;
      if (!to || !text) return res.status(400).json({ error: "to & text required" });
      const num = normalizeNumber(to);
      const jid = `${num}@s.whatsapp.net`;
      await sock.sendMessage(jid, { text });
      db.run("INSERT INTO logs (user_id, number, type, status, error) VALUES (?,?,?,?,?)",
        [req.session.user.id, to, "single", "success", null]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // expose small helper to admin to cancel
  router.post("/admin/cancel-blast", (req, res) => {
    if (req.session.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    cancelFlag = true;
    res.json({ ok: true });
  });

  return router;
};
