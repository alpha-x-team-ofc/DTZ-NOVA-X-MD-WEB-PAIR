import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 10000;

// Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Import and use pair router
let pairRouter;
try {
    pairRouter = (await import('./pair.js')).default;
    app.use('/api/code', pairRouter);
    console.log('✅ Pair router loaded successfully');
} catch (error) {
    console.error('❌ Failed to load pair router:', error);
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/pair', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// Health check endpoints
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        service: 'DTZ NOVA X MD',
        version: '2.1.0',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime())
    });
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Test endpoints to verify routing
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API is working!',
        endpoints: [
            '/api/code/qr',
            '/api/code/phone',
            '/api/code/status/:sessionId',
            '/api/health'
        ]
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('💥 Server Error:', err);
    res.status(500).json({ 
        success: false,
        error: 'Internal server error',
        message: 'Something went wrong. Please try again later.'
    });
});

// 404 handler - must be last
app.use('*', (req, res) => {
    if (req.originalUrl.startsWith('/api/')) {
        res.status(404).json({ 
            success: false,
            error: 'Endpoint not found',
            message: `The route ${req.originalUrl} does not exist.`,
            availableEndpoints: [
                'GET /',
                'GET /pair',
                'GET /api/code/qr',
                'GET /api/code/phone?number=PHONE',
                'GET /api/code/status/:sessionId',
                'GET /api/health',
                'GET /api/test'
            ]
        });
    } else {
        res.status(404).send(`
            <html>
                <head><title>404 - Page Not Found</title></head>
                <body style="background: #000; color: #05e6ff; font-family: Arial; text-align: center; padding: 50px;">
                    <h1>🤖 DTZ NOVA X MD</h1>
                    <h2>404 - Page Not Found</h2>
                    <p>The page you're looking for doesn't exist.</p>
                    <a href="/" style="color: #05e6ff;">Go to Home Page</a>
                </body>
            </html>
        `);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🚀 DTZ NOVA X MD Server Started
📍 Port: ${PORT}
🌐 Environment: ${process.env.NODE_ENV || 'development'}
📱 Version: 2.1.0
🕒 Started at: ${new Date().toLocaleString()}
    
📋 Available Routes:
   ✅ GET  /                 - Main interface
   ✅ GET  /pair             - Pairing page  
   ✅ GET  /api/code/qr      - QR code generation
   ✅ GET  /api/code/phone   - Phone pairing
   ✅ GET  /api/health       - Health check
   ✅ GET  /api/test         - Test endpoint
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received - shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received - shutting down gracefully');
    process.exit(0);
});

export default app;
