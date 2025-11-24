import express from 'express';
import fs from 'fs/promises';
import pino from 'pino';
import qrcode from 'qrcode';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay,
    makeCacheableSignalKeyStore,
    DisconnectReason
} from '@whiskeysockets/baileys';

const router = express.Router();

// Store active sessions
const activeSessions = new Map();

async function cleanupSession(sessionDir) {
    try {
        await fs.rm(sessionDir, { recursive: true, force: true });
        activeSessions.delete(sessionDir);
        console.log(`🧹 Cleaned up session: ${sessionDir}`);
    } catch (error) {
        console.log('Cleanup warning:', error.message);
    }
}

// QR Code pairing endpoint
router.get('/qr', async (req, res) => {
    const sessionId = 'session_' + Date.now();
    const sessionDir = `./${sessionId}`;

    console.log('🔐 Starting QR pairing session');
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const socketConfig = {
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
            printQRInTerminal: true,
            logger: pino({ level: "silent" }),
            browser: ["Chrome", "Windows", "121.0.0.0"],
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
        };

        const bot = makeWASocket(socketConfig);

        let qrGenerated = false;

        bot.ev.on('creds.update', saveCreds);

        bot.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            console.log(`🔗 Connection state: ${connection}`);

            if (qr && !qrGenerated) {
                console.log('📱 QR Code received');
                qrGenerated = true;
                
                try {
                    // Generate QR code as data URL
                    const qrImage = await qrcode.toDataURL(qr);
                    
                    // Store session info
                    activeSessions.set(sessionId, {
                        bot,
                        sessionDir,
                        connected: false
                    });

                    res.json({
                        success: true,
                        qrCode: qrImage,
                        sessionId: sessionId,
                        message: 'Scan this QR code with WhatsApp'
                    });

                } catch (qrError) {
                    console.error('QR generation error:', qrError);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Failed to generate QR code' });
                    }
                }
            }

            if (connection === "open") {
                console.log('✅ WhatsApp connected successfully!');
                
                const session = activeSessions.get(sessionId);
                if (session) {
                    session.connected = true;
                    
                    // Send welcome message
                    try {
                        const botInfo = bot.user;
                        if (botInfo && botInfo.id) {
                            await bot.sendMessage(botInfo.id, { 
                                text: `✅ *DTZ NOVA X MD CONNECTED!*\n\n🤖 Your WhatsApp is now connected to DTZ NOVA X MD\n\n📢 Join our channel: https://chat.whatsapp.com/KJnHbIYysdrJhCLH8C1HFe\n\n👤 Contact owner: wa.me/94752978237\n\n⚠️ *DO NOT SHARE YOUR SESSION DATA*` 
                            });
                            console.log('📨 Welcome message sent');
                        }
                    } catch (msgError) {
                        console.log('Message send warning:', msgError.message);
                    }

                    // Keep session alive for 30 seconds
                    setTimeout(async () => {
                        await cleanupSession(sessionDir);
                        process.exit(0);
                    }, 30000);
                }
            }

            if (connection === "close") {
                console.log('❌ Connection closed');
                await cleanupSession(sessionDir);
            }
        });

        // Timeout if no QR code in 30 seconds
        setTimeout(() => {
            if (!qrGenerated && !res.headersSent) {
                res.status(408).json({ error: 'QR code timeout' });
                cleanupSession(sessionDir);
            }
        }, 30000);

    } catch (error) {
        console.error('💥 Session error:', error);
        await cleanupSession(sessionDir);
        
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Session failed',
                message: 'Please try again'
            });
        }
    }
});

// Check connection status
router.get('/status/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
        return res.json({ connected: false, error: 'Session not found' });
    }
    
    res.json({ 
        connected: session.connected,
        message: session.connected ? 'WhatsApp connected successfully!' : 'Waiting for QR scan...'
    });
});

// Phone number pairing (fallback)
router.get('/phone', async (req, res) => {
    const { number } = req.query;
    
    if (!number) {
        return res.status(400).json({ error: 'Phone number required' });
    }

    const cleanNumber = number.replace(/\D/g, '');
    const sessionDir = `./session_${cleanNumber}_${Date.now()}`;

    console.log(`📞 Attempting phone pairing for: ${cleanNumber}`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const socketConfig = {
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: ["Ubuntu", "Chrome", "121.0.0.0"],
            connectTimeoutMs: 30000,
        };

        const bot = makeWASocket(socketConfig);

        bot.ev.on('creds.update', saveCreds);

        if (!bot.authState.creds.registered) {
            await delay(3000);
            
            try {
                const pairingCode = await bot.requestPairingCode(cleanNumber);
                console.log(`✅ Pairing code: ${pairingCode}`);
                
                res.json({
                    success: true,
                    code: pairingCode,
                    message: 'Use this code in WhatsApp: Linked Devices → Link a Device',
                    note: 'If this fails, try the QR code method instead'
                });

                // Set cleanup timeout
                setTimeout(async () => {
                    await cleanupSession(sessionDir);
                    process.exit(0);
                }, 45000);

            } catch (pairError) {
                console.error('Pairing error:', pairError.message);
                await cleanupSession(sessionDir);
                
                res.json({
                    success: false,
                    error: 'Phone pairing failed',
                    message: 'Please use QR code method instead',
                    alternative: '/api/code/qr'
                });
            }
        }

    } catch (error) {
        console.error('Phone pairing failed:', error);
        await cleanupSession(sessionDir);
        
        res.json({
            success: false,
            error: 'Phone pairing not available',
            message: 'Please use QR code method',
            qrEndpoint: '/api/code/qr'
        });
    }
});

export default router;
