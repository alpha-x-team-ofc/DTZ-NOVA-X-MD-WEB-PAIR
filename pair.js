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
    console.log('📡 QR code endpoint hit');
    
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

                    console.log('✅ QR code generated and sent to client');
                    res.json({
                        success: true,
                        qrCode: qrImage,
                        sessionId: sessionId,
                        message: 'Scan this QR code with WhatsApp'
                    });

                } catch (qrError) {
                    console.error('QR generation error:', qrError);
                    if (!res.headersSent) {
                        res.status(500).json({ 
                            success: false,
                            error: 'Failed to generate QR code',
                            message: 'Please try again'
                        });
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
                console.log('⏰ QR generation timeout');
                res.status(408).json({ 
                    success: false,
                    error: 'QR code timeout',
                    message: 'Please try generating a new QR code'
                });
                cleanupSession(sessionDir);
            }
        }, 30000);

    } catch (error) {
        console.error('💥 QR Session error:', error);
        await cleanupSession(sessionDir);
        
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false,
                error: 'Session failed',
                message: 'Please try again'
            });
        }
    }
});

// Phone number pairing endpoint
router.get('/phone', async (req, res) => {
    console.log('📡 Phone pairing endpoint hit');
    
    const { number } = req.query;
    
    if (!number) {
        return res.status(400).json({ 
            success: false,
            error: 'Phone number required',
            message: 'Please provide a phone number parameter'
        });
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
                console.log(`✅ Pairing code generated: ${pairingCode}`);
                
                res.json({
                    success: true,
                    code: pairingCode,
                    message: 'Use this code in WhatsApp: Linked Devices → Link a Device',
                    number: cleanNumber
                });

                // Set cleanup timeout
                setTimeout(async () => {
                    await cleanupSession(sessionDir);
                    process.exit(0);
                }, 45000);

            } catch (pairError) {
                console.error('❌ Pairing error:', pairError.message);
                await cleanupSession(sessionDir);
                
                res.json({
                    success: false,
                    error: 'Phone pairing failed',
                    message: 'Please use QR code method instead',
                    alternative: '/api/code/qr'
                });
            }
        } else {
            await cleanupSession(sessionDir);
            res.json({
                success: false,
                error: 'Already registered',
                message: 'This number appears to be already registered'
            });
        }

    } catch (error) {
        console.error('💥 Phone pairing failed:', error);
        await cleanupSession(sessionDir);
        
        res.json({
            success: false,
            error: 'Phone pairing not available',
            message: 'Please use QR code method',
            qrEndpoint: '/api/code/qr'
        });
    }
});

// Check connection status endpoint
router.get('/status/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    console.log(`📡 Status check for session: ${sessionId}`);
    
    const session = activeSessions.get(sessionId);
    
    if (!session) {
        return res.json({ 
            success: false,
            connected: false, 
            error: 'Session not found or expired' 
        });
    }
    
    res.json({ 
        success: true,
        connected: session.connected,
        message: session.connected ? 'WhatsApp connected successfully!' : 'Waiting for QR scan...'
    });
});

// Test endpoint
router.get('/test', (req, res) => {
    res.json({ 
        success: true,
        message: 'Pair router is working!',
        endpoints: [
            'GET /api/code/qr',
            'GET /api/code/phone?number=PHONE',
            'GET /api/code/status/:sessionId',
            'GET /api/code/test'
        ]
    });
});

export default router;
