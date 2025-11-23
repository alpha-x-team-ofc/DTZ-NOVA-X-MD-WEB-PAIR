import express from 'express';
import fs from 'fs/promises';
import pino from 'pino';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore,
    DisconnectReason
} from '@whiskeysockets/baileys';

const router = express.Router();

// Session management
const activeSessions = new Map();
const SESSION_TIMEOUT = 120000; // 2 minutes

async function cleanupSession(sessionDir) {
    try {
        await fs.rm(sessionDir, { recursive: true, force: true });
        activeSessions.delete(sessionDir);
        console.log(`🧹 Cleaned up session: ${sessionDir}`);
    } catch (error) {
        console.log('Cleanup warning:', error.message);
    }
}

function generateSessionId() {
    return 'session_' + Math.random().toString(36).substring(2, 15);
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    
    if (!number) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    const cleanNumber = number.replace(/\D/g, '');
    
    if (cleanNumber.length < 7) {
        return res.status(400).json({ error: 'Invalid phone number' });
    }

    const sessionId = generateSessionId();
    const sessionDir = `./${sessionId}`;

    // Set response headers for long-running request
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        console.log(`🔐 Starting pairing for: ${cleanNumber}`);
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        // Enhanced socket configuration for cloud environments
        const socketConfig = {
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "error" }),
            browser: ["Chrome", "Windows", "10.0.0"],
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            patchMessageBeforeSending: (message) => {
                const requiresPatch = !!(
                    message.buttonsMessage 
                    || message.templateMessage
                    || message.listMessage
                );
                if (requiresPatch) {
                    message = {
                        viewOnceMessage: {
                            message: {
                                messageContextInfo: {
                                    deviceListMetadata: {},
                                    deviceListMetadataVersion: 2
                                },
                                ...message
                            }
                        }
                    };
                }
                return message;
            },
            retryRequestDelayMs: 1000,
            maxMsgRetryCount: 3,
            connectTimeoutMs: 30000,
            keepAliveIntervalMs: 15000
        };

        const bot = makeWASocket(socketConfig);

        // Handle credentials update
        bot.ev.on('creds.update', saveCreds);

        // Handle connection events
        bot.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            console.log(`🔗 Connection update: ${connection}`);

            if (qr) {
                console.log('📱 QR Code received');
            }

            if (connection === "open") {
                console.log(`✅ Connected successfully to ${cleanNumber}`);
                
                try {
                    // Send welcome message
                    const userJid = `${cleanNumber}@s.whatsapp.net`;
                    await bot.sendMessage(userJid, { 
                        text: `✅ *DTZ NOVA X MD CONNECTED SUCCESSFULLY!*\n\n🤖 Your WhatsApp is now connected to DTZ NOVA X MD\n\n📢 Join our channel: https://chat.whatsapp.com/KJnHbIYysdrJhCLH8C1HFe\n\n👤 Contact owner: wa.me/94752978237\n\n⚠️ *DO NOT SHARE YOUR SESSION DATA*` 
                    });
                    
                    console.log(`📨 Welcome message sent to ${cleanNumber}`);
                    
                } catch (msgError) {
                    console.log('💬 Message send warning:', msgError.message);
                } finally {
                    // Cleanup and exit
                    await cleanupSession(sessionDir);
                    setTimeout(() => {
                        console.log('🛑 Process exiting after successful connection');
                        process.exit(0);
                    }, 3000);
                }

            } else if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`❌ Connection closed: ${statusCode}`, lastDisconnect?.error?.message);
                
                if (shouldReconnect) {
                    console.log('🔄 Attempting to reconnect...');
                } else {
                    await cleanupSession(sessionDir);
                }
            } else if (connection === "connecting") {
                console.log('🔄 Connecting to WhatsApp...');
            }
        });

        // Wait a bit for connection to stabilize
        await delay(3000);

        // Request pairing code with error handling
        if (!bot.authState.creds.registered) {
            console.log('📞 Requesting pairing code...');
            
            try {
                const pairingCode = await bot.requestPairingCode(cleanNumber);
                console.log(`✅ Pairing code generated: ${pairingCode}`);
                
                if (!res.headersSent) {
                    res.json({ 
                        success: true,
                        code: pairingCode,
                        message: 'Pairing code generated successfully',
                        number: cleanNumber
                    });
                }

                // Set cleanup timeout
                const timeoutId = setTimeout(async () => {
                    console.log('⏰ Session timeout reached');
                    await cleanupSession(sessionDir);
                    if (bot) {
                        try {
                            await bot.logout();
                        } catch (e) {
                            console.log('Logout error:', e.message);
                        }
                    }
                    process.exit(0);
                }, SESSION_TIMEOUT);

                activeSessions.set(sessionDir, { bot, timeoutId });

            } catch (pairingError) {
                console.error('❌ Pairing code error:', pairingError);
                
                await cleanupSession(sessionDir);
                
                if (!res.headersSent) {
                    res.status(500).json({ 
                        success: false,
                        error: 'Failed to generate pairing code',
                        details: 'WhatsApp connection issue. Please try again.',
                        debug: pairingError.message
                    });
                }
            }
        } else {
            console.log('ℹ️ Already registered');
            await cleanupSession(sessionDir);
            
            if (!res.headersSent) {
                res.status(400).json({ 
                    success: false,
                    error: 'Already registered',
                    message: 'This number is already registered with WhatsApp Web'
                });
            }
        }

    } catch (error) {
        console.error('💥 Session initialization error:', error);
        
        await cleanupSession(sessionDir);
        
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false,
                error: 'Session initialization failed',
                details: 'Please check the phone number and try again',
                debug: error.message
            });
        }
    }
});

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'Pairing Service',
        activeSessions: activeSessions.size,
        timestamp: new Date().toISOString()
    });
});

// Cleanup on process exit
process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received - cleaning up...');
    for (const [sessionDir, { timeoutId }] of activeSessions) {
        clearTimeout(timeoutId);
        await cleanupSession(sessionDir);
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT received - shutting down...');
    for (const [sessionDir, { timeoutId }] of activeSessions) {
        clearTimeout(timeoutId);
        await cleanupSession(sessionDir);
    }
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.log('⚠️ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

export default router;
