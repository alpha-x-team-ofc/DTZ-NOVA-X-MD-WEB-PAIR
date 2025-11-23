import express from 'express';
import fs from 'fs/promises';
import pino from 'pino';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore, 
    jidNormalizedUser 
} from '@whiskeysockets/baileys';

const router = express.Router();

// Session timeout (2 minutes for Render)
const SESSION_TIMEOUT = 120000;
const activeSessions = new Map();

async function cleanupSession(sessionDir) {
    try {
        await fs.rm(sessionDir, { recursive: true, force: true });
        activeSessions.delete(sessionDir);
        console.log(`Cleaned up session: ${sessionDir}`);
    } catch (error) {
        console.log('Cleanup warning:', error.message);
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    
    if (!number) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    const cleanNumber = number.replace(/\D/g, '');
    const sessionDir = `./session_${cleanNumber}`;
    
    // Set response timeout
    res.setTimeout(SESSION_TIMEOUT, () => {
        if (!res.headersSent) {
            res.status(408).json({ error: 'Request timeout' });
        }
    });

    try {
        // Cleanup existing session
        if (activeSessions.has(sessionDir)) {
            await cleanupSession(sessionDir);
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const socketConfig = {
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: ["DTZ-NOVA-X-MD", "Chrome", "1.0.0"],
        };

        const bot = makeWASocket(socketConfig);

        if (!bot.authState.creds.registered) {
            await delay(2000);
            const pairingCode = await bot.requestPairingCode(cleanNumber);
            
            if (!res.headersSent) {
                res.json({ 
                    code: pairingCode,
                    message: 'Pairing code generated successfully'
                });
            }

            // Auto-cleanup after timeout
            const timeoutId = setTimeout(() => {
                cleanupSession(sessionDir);
                process.exit(0);
            }, SESSION_TIMEOUT);

            activeSessions.set(sessionDir, { bot, timeoutId });
        }

        bot.ev.on('creds.update', saveCreds);
        
        bot.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log(`✅ Connected successfully to ${cleanNumber}`);
                
                try {
                    await delay(5000);
                    
                    // Send success message
                    const userJid = jidNormalizedUser(cleanNumber + '@s.whatsapp.net');
                    await bot.sendMessage(userJid, { 
                        text: `✅ *DTZ NOVA X MD CONNECTED*\n\n📱 Your WhatsApp is now connected to DTZ NOVA X MD\n\n🔗 Channel: https://chat.whatsapp.com/KJnHbIYysdrJhCLH8C1HFe\n\n👤 Owner: wa.me/94752978237\n\n⚠️ *DO NOT SHARE YOUR SESSION*` 
                    });
                    
                    console.log(`📨 Success message sent to ${cleanNumber}`);
                    
                    // Cleanup and exit
                    await cleanupSession(sessionDir);
                    setTimeout(() => process.exit(0), 1000);
                    
                } catch (msgError) {
                    console.log('Message send error:', msgError.message);
                }

            } else if (connection === 'close') {
                console.log(`❌ Connection closed for ${cleanNumber}`);
                await cleanupSession(sessionDir);
            }
        });

    } catch (error) {
        console.error('Session error:', error);
        
        // Cleanup on error
        await cleanupSession(sessionDir);
        
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Failed to generate pairing code',
                details: error.message 
            });
        }
    }
});

// Cleanup on process exit
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down...');
    for (const [sessionDir, { timeoutId }] of activeSessions) {
        clearTimeout(timeoutId);
        await cleanupSession(sessionDir);
    }
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.log('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});

export default router;
