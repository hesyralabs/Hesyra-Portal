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
app.use(express.json({ limit: '10mb' }));

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


// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Hesyra Server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready for real-time connections`);
  console.log(`💳 Payment system: ${process.env.RAZORPAY_MODE === 'live' ? 'LIVE' : 'TEST/STUB'} mode`);
  
  // Start strike scheduler
  startScheduler(io);
});
