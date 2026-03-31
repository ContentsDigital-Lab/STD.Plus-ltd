const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('./config/env');
const Worker = require('./models/Worker');

const setupSocket = (httpServer) => {
  const io = new Server(httpServer, {
    path: '/api/socket-entry',
    cors: {
      origin: env.CORS_ORIGIN,
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
      return next(new Error('Not authenticated'));
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      const worker = await Worker.findById(decoded.id).populate('role');
      if (!worker) return next(new Error('User no longer exists'));
      socket.user = worker;
      next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });

  const ROOMS = ['dashboard', 'inventory', 'station', 'log', 'request', 'withdrawal', 'order', 'claim', 'pane', 'production', 'pricing'];

  const lastScanByStation = new Map();
  const REPLAY_WINDOW_MS = 15000;

  io.on('connection', (socket) => {
    console.log(`[socket] ${socket.user.name} connected (${socket.id})`);

    socket.join(`user:${socket.user._id}`);

    socket.on('join_me', (callback) => {
      socket.join(`user:${socket.user._id}`);
      console.log(`[socket] ${socket.user.name} joined room user:${socket.user._id}`);
      if (typeof callback === 'function') callback({ ok: true, room: `user:${socket.user._id}` });
    });

    for (const room of ROOMS) {
      socket.on(`join_${room}`, (callback) => {
        socket.join(room);
        console.log(`[socket] ${socket.user.name} joined room ${room}`);
        if (typeof callback === 'function') callback({ ok: true, room });
      });

      socket.on(`leave_${room}`, (callback) => {
        socket.leave(room);
        console.log(`[socket] ${socket.user.name} left room ${room}`);
        if (typeof callback === 'function') callback({ ok: true, room });
      });
    }

    socket.on('join_station_room', (data, callback) => {
      const stationId = data?.stationId;
      if (!stationId) {
        if (typeof callback === 'function') callback({ ok: false, error: 'stationId is required' });
        return;
      }
      const room = `station:${stationId}`;
      socket.join(room);
      console.log(`[socket] ${socket.user.name} joined room ${room}`);
      if (typeof callback === 'function') callback({ ok: true, room });
    });

    socket.on('leave_station_room', (data, callback) => {
      const stationId = data?.stationId;
      if (!stationId) {
        if (typeof callback === 'function') callback({ ok: false, error: 'stationId is required' });
        return;
      }
      const room = `station:${stationId}`;
      socket.leave(room);
      console.log(`[socket] ${socket.user.name} left room ${room}`);
      if (typeof callback === 'function') callback({ ok: true, room });
    });

    // QR check-in: station screen joins its room and receives replayed scans
    socket.on('join-station', (stationId, callback) => {
      if (!stationId || typeof stationId !== 'string') {
        if (typeof callback === 'function') callback({ ok: false, error: 'stationId is required' });
        return;
      }
      const room = `station:${stationId}`;
      socket.join(room);
      console.log(`[socket] ${socket.user.name} joined station ${stationId}`);

      const last = lastScanByStation.get(stationId);
      if (last && Date.now() - last.at < REPLAY_WINDOW_MS) {
        socket.emit('scan-confirmed', { worker: last.worker, time: last.time });
      }
      if (typeof callback === 'function') callback({ ok: true, room });
    });

    // QR check-in: mobile sends scan, server broadcasts to the station room
    socket.on('mobile-scan', (data, callback) => {
      if (!data?.stationId) {
        if (typeof callback === 'function') callback({ ok: false, error: 'stationId is required' });
        return;
      }

      const worker = data.worker || socket.user.name;
      const time = new Date().toLocaleTimeString();
      const room = `station:${data.stationId}`;

      lastScanByStation.set(data.stationId, { worker, time, at: Date.now() });
      io.to(room).emit('scan-confirmed', { worker, time });

      console.log(`[socket] mobile-scan from ${socket.user.name} at station ${data.stationId}`);
      if (typeof callback === 'function') callback({ ok: true });
    });

    socket.on('system_alert', (data) => {
      if (!socket.user.role?.permissions?.includes('*')) {
        return socket.emit('error', { message: 'Not authorized to send system alerts' });
      }
      console.log(`[socket] system_alert from ${socket.user.name}:`, data);
      io.emit('system_alert', data);
    });

    socket.on('error', (err) => {
      console.error(`[socket] Error for ${socket.user.name}:`, err.message);
      socket.emit('error', { message: err.message });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[socket] ${socket.user.name} disconnected (${reason})`);
    });
  });

  return io;
};

module.exports = setupSocket;
