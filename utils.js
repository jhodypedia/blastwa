// utils.js
function normalizeNumber(raw) {
  if (!raw) throw new Error("Empty number");
  let num = String(raw).replace(/[^0-9]/g, "");
  if (!num) throw new Error("Nomor tidak valid");
  // 08xxxx -> 62xxxx
  if (num.startsWith("0")) num = "62" + num.slice(1);
  // if starts with +, removed earlier; allow 62... or other country codes
  if (num.length < 9 || num.length > 15) throw new Error("Nomor tidak valid: " + num);
  return num;
}

module.exports = { normalizeNumber };
