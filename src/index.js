require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mqttClient = require('./mqtt/client');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static('ui'));
app.set('io', io);

// Routes
app.use('/api/sensors',    require('./api/routes/sensors'));
app.use('/api/devices',    require('./api/routes/devices'));
app.use('/api/zones',      require('./api/routes/zones'));
app.use('/api/alarms',     require('./api/routes/alarms'));
app.use('/api/signal',      require('./api/routes/signal'));
app.use('/api/connection',  require('./api/routes/connection'));
app.use('/api/management',  require('./api/routes/management'));

// Socket.IO
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// Start HTTP server
const PORT = parseInt(process.env.HTTP_PORT) || 3000;
server.listen(PORT, () => {
  console.log(`[Server] HTTP + Socket.IO listening on port ${PORT}`);
});

// Backfill any devices missing zone assignments
const { backfillZoneAssignments } = require('./services/deviceService');
backfillZoneAssignments().catch(err => console.error('[Backfill] Zone assignment error:', err));

// Reset all zone alarm levels to normal on startup (clears stale warning/danger state)
const pool = require('./db/pool');
pool.query("UPDATE zones SET alarm_level = 'normal'")
  .then(() => console.log('[Server] Zone alarm levels reset to normal'))
  .catch(err => console.error('[Server] Zone reset error:', err));

// Start MQTT client
mqttClient.init(io);

// Start simulation engine (no-op if SIMULATION_ENGINE=false in .env)
const simEngine = require('./services/simulationEngine');
simEngine.start(io);

// Catch unhandled errors so the process doesn't die silently
process.on('uncaughtException',       (err) => console.error('[FATAL] Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('[FATAL] Unhandled Rejection:', reason));

// Graceful shutdown
let shuttingDown = false;
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[Server] Shutting down...');

  const { stopAll } = require('./services/watchdogService');
  stopAll();
  simEngine.stop();

  // Force exit after 3s in case open connections block server.close()
  const timer = setTimeout(() => {
    console.log('[Server] Force exit after timeout');
    process.exit(0);
  }, 3000);
  timer.unref();

  io.close();
  server.close(() => process.exit(0));
}
