import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser } from '@whiskeysockets/baileys';
import { upload } from './mega.js';

const router = express.Router();

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);
    
    // Remove existing session if present
    await removeFile(dirs);
    
    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            let SUPUNMDInc = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: ["Ubuntu", "Chrome", "20.0.04"],
            });

            if (!SUPUNMDInc.authState.creds.registered) {
                await delay(2000);
                num = num.replace(/[^0-9]/g, '');
                const code = await SUPUNMDInc.requestPairingCode(num);
                if (!res.headersSent) {
                    console.log({ num, code });
                    await res.send({ code });
                }
            }

            SUPUNMDInc.ev.on('creds.update', saveCreds);
            SUPUNMDInc.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    await delay(10000);
                    const sessionGlobal = fs.readFileSync(dirs + '/creds.json');

                    // Helper to generate a random Mega file ID
                    function generateRandomId(length = 6, numberLength = 4) {
                        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                        let result = '';
                        for (let i = 0; i < length; i++) {
                            result += characters.charAt(Math.floor(Math.random() * characters.length));
                        }
                        const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                        return `${result}${number}`;
                    }

                    // Upload session file to Mega
                    const megaUrl = await upload(fs.createReadStream(`${dirs}/creds.json`), `${generateRandomId()}.json`);
                    let stringSession = megaUrl.replace('https://mega.nz/file/', ''); // Extract session ID from URL
                    stringSession = 'DTZ-NOVA-X-MD=' + stringSession;  // Prepend your name to the session ID

                    // Send the session ID to the target number
                    const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                    await SUPUNMDInc.sendMessage(userJid, { text: stringSession });

                    // Send confirmation message
                    await SUPUNMDInc.sendMessage(userJid, { text: "DTZ NOVA X MD 𝐒𝐄𝐒𝐒𝐈𝐎𝐍 𝐒𝐔𝐂𝐂𝐄𝐒𝐅𝐔𝐋𝐋👇*\n\n*⭕ WHATSAPP CHANNEL :https://chat.whatsapp.com/KJnHbIYysdrJhCLH8C1HFe*\n\n> \n\n*⭕Contact Owner :*\n\n> wa.me/94752978237\n\n\n🚫 *𝗗𝗢𝗡𝗧 𝗦𝗛𝗔𝗥𝗘 𝗬𝗢𝗨𝗥 𝗦𝗘𝗦𝗦𝗜𝗢𝗡 𝗜𝗗* 🚫" });
                    
                    // Clean up session after use
                    await delay(100);
                    removeFile(dirs);
                    // Instead of exiting, just clean up and allow new sessions
                    console.log('Session cleaned up for', num);
                } else if (connection === 'close' && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
                    console.log('Connection closed unexpectedly:', lastDisconnect.error);
                    // Limit retries to avoid infinite loop
                    if (!s.retryCount) s.retryCount = 0;
                    s.retryCount++;
                    if (s.retryCount <= 3) {
                        console.log(`Retrying session initiation (attempt ${s.retryCount})...`);
                        await delay(10000);
                        initiateSession();
                    } else {
                        console.log('Max retry attempts reached. Please try again later.');
                        if (!res.headersSent) {
                            res.status(408).send({ error: 'Connection closed after multiple attempts. Please retry.' });
                        }
                    }
                }
            });
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ error: 'Service Unavailable. Please retry.' });
            }
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    console.log('Caught exception: ' + err);
});

export default router;
