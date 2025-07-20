const express = require("express");
const path = require("path");
const qrcode = require("qrcode");
const fs = require("fs");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = 3000;
const TEMP_DIR = path.join(__dirname, "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

let lastQR = null;
let sessionId = null;
let connected = false;

// ==================== ROUTES ====================

// QR / Session status
app.get("/status", (req, res) => {
  if (connected && sessionId) {
    return res.json({ status: "connected", sessionId });
  }
  if (lastQR) {
    return res.json({ status: "qr", qr: lastQR });
  }
  res.json({ status: "pending" });
});

// Serve main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// ==================== SOCKET START ====================
async function startSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(TEMP_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["WASI-QR-WEB", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr } = update;

    if (qr) {
      lastQR = await qrcode.toDataURL(qr);
      console.log("🔍 QR Code updated. Waiting for scan...");
    }

    if (connection === "open") {
      connected = true;
      console.log("✅ WhatsApp connected successfully!");

      // Read and save SESSION_ID
      const credsPath = path.join(TEMP_DIR, "creds.json");
      sessionId = Buffer.from(fs.readFileSync(credsPath)).toString("base64");
      fs.writeFileSync(path.join(__dirname, "session_id.txt"), sessionId);

      // Send SESSION_ID + WASI message to WhatsApp
      try {
        const jid = sock.user.id;

        // Send as file
        await sock.sendMessage(jid, {
          document: Buffer.from(sessionId, "utf-8"),
          fileName: "session_id.txt",
          mimetype: "text/plain",
          caption: "Your full WASI-MD SESSION_ID file."
        });

        // Send WASI message with SESSION_ID
        const wasiMessage = `
*🤖 WASI-MD BOT CONNECTED*

Thank you for connecting to *WASI-MD Server*.

Here is your complete SESSION_ID (keep it safe):
\`\`\`
${sessionId}
\`\`\`

_Use this SESSION_ID in your main bot to avoid scanning QR again._

Made with ❤️ by WASI TECH.
`;
        await sock.sendMessage(jid, { text: wasiMessage });

        console.log("📨 Full SESSION_ID and WASI message sent.");
      } catch (err) {
        console.error("❌ Failed to send SESSION_ID to WhatsApp:", err);
      }
    }

    if (connection === "close") {
      connected = false;
      console.log("❌ Connection closed. Reconnecting in 5s...");
      setTimeout(startSocket, 5000);
    }
  });
}

// Start the socket
startSocket();

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 WASI QR Web running at http://localhost:${PORT}`);
});
