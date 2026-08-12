const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
require('dotenv').config();

// Route modules
const authRoutes    = require('./routes/auth');
const caseRoutes    = require('./routes/cases');
const invoiceRoutes = require('./routes/invoices');
const adminRoutes   = require('./routes/admin');
const paymentRoutes = require('./routes/payment');
const walletRoutes  = require('./routes/wallet');
const strikeRoutes  = require('./routes/strikes');
const managerRoutes = require('./routes/manager');
const designerRoutes= require('./routes/designer');
const auditRoutes   = require('./routes/audit');
const poolRoutes    = require('./routes/pool');
const batchRoutes   = require('./routes/batch');
const catalogRoutes = require('./routes/catalog');
const scanDayRoutes = require('./routes/scanday');
const recordRoutes  = require('./routes/records');

// Scheduler
const { startScheduler } = require('./lib/strikeScheduler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
});

// Make io accessible to routes
app.set('io', io);

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false })); // Allowed for cross-origin images/STLs from UI
app.use(cors());
// Keep the exact bytes of every JSON body on the request.
//
// The Razorpay webhook signature is an HMAC over the payload as sent.
// Re-serialising the parsed object does not reproduce it — key order,
// unicode escaping and whitespace all differ — so verification against
// JSON.stringify(req.body) rejects every legitimate webhook. Mounting
// express.raw() on the webhook route does not help either: this parser
// runs first, marks the body consumed, and raw() then skips itself.
// Capturing the buffer here is the one place that sees the real bytes.
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Health Check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date(), version: '2.0.0-payment' });
});

// ─── API Routes ───────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/cases',    caseRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/payment',  paymentRoutes);
app.use('/api/wallet',   walletRoutes);
app.use('/api/strikes',  strikeRoutes);
app.use('/api/manager',  managerRoutes);
app.use('/api/designer', designerRoutes);
app.use('/api/audit',    auditRoutes);
app.use('/api/pool',     poolRoutes);
app.use('/api/batch',    batchRoutes);
app.use('/api/catalog',  catalogRoutes);
app.use('/api/scan-day', scanDayRoutes);
app.use('/api/records',  recordRoutes);

// ─── WebSocket ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// ─── Serve built frontend (production) ────────────────────────
const distPath = path.resolve(__dirname, '..', 'dist');
const indexPath = path.resolve(distPath, 'index.html');
app.use(express.static(distPath));

// SPA catch-all — must be AFTER all /api routes
// Serves index.html for any GET that isn't an API call, so React Router handles it.
app.use((req, res, next) => {
  // Only intercept GET requests (not POST, PUT, etc.)
  if (req.method !== 'GET') return next();
  // Skip API routes
  if (req.path.startsWith('/api/')) return next();
  // Skip static asset requests — let them 404 naturally instead of serving index.html
  if (req.path.match(/\.(js|css|map|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp|webm|mp4|json)$/i)) {
    return next();
  }

  // Read and serve index.html directly — avoids Express sendFile path resolution issues on Windows
  try {
    const html = fs.readFileSync(indexPath, 'utf8');
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('SPA fallback error:', err.message);
    res.status(500).send('<!DOCTYPE html><html><body><h1>Build Required</h1><p>Run <code>npm run build</code> to generate the frontend bundle.</p></body></html>');
  }
});

// ─── Error Handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});


// ─── Production configuration gate ────────────────────────────
// Everything below is fatal in live mode and a warning otherwise.
//
// The failure these prevent is silent and expensive: a live deployment
// that boots, takes orders, and only reveals at the payment step that
// it has no credentials — or worse, issues tax invoices carrying a
// placeholder GSTIN, which have to be credited and reissued.
function checkLaunchConfig() {
  const razorpay = require('./lib/razorpay');
  const config = require('./lib/config');
  const problems = [];

  const missingKeys = razorpay.missingLiveConfig();
  if (missingKeys.length) {
    problems.push(`Razorpay credentials not set: ${missingKeys.join(', ')}`);
  }

  if (!config.isGstinConfigured()) {
    problems.push(`HESYRA_GSTIN is unset or still the placeholder (${config.HESYRA_GSTIN}) — invoices issued against it are not valid tax documents`);
  }

  if (!process.env.JWT_SECRET) {
    problems.push('JWT_SECRET is not set');
  }

  if (!problems.length) return;

  if (razorpay.isLive()) {
    console.error('\n❌ Refusing to start in live mode with an incomplete configuration:\n');
    problems.forEach(p => console.error(`   • ${p}`));
    console.error('\nFix these in server/.env, or run with RAZORPAY_MODE=test for local development.\n');
    process.exit(1);
  }

  console.warn('\n⚠️  Not launch-ready — these must be resolved before going live:');
  problems.forEach(p => console.warn(`   • ${p}`));
  console.warn('');
}

// ─── Start ────────────────────────────────────────────────────
checkLaunchConfig();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Hesyra Server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready for real-time connections`);
  console.log(`💳 Payment system: ${process.env.RAZORPAY_MODE === 'live' ? 'LIVE' : 'TEST/STUB'} mode`);
  
  // Start strike scheduler
  startScheduler(io);
});
