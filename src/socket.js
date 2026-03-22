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
      const worker = await Worker.findById(decoded.id);
      if (!worker) return next(new Error('User no longer exists'));
      socket.user = worker;
      next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });

  const ROOMS = ['dashboard', 'inventory', 'station', 'log', 'request', 'withdrawal', 'order', 'claim'];

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

    // Per-station rooms — workers join when viewing a specific station page
    // stationId can be a MongoDB ObjectId string or any station identifier
    socket.on('join_station_room', (stationId, callback) => {
      if (!stationId || typeof stationId !== 'string') return;
      const roomId = `station:${stationId}`;
      socket.join(roomId);
      console.log(`[socket] ${socket.user.name} joined station room ${roomId}`);
      if (typeof callback === 'function') callback({ ok: true, room: roomId });
    });

    socket.on('leave_station_room', (stationId, callback) => {
      if (!stationId || typeof stationId !== 'string') return;
      const roomId = `station:${stationId}`;
      socket.leave(roomId);
      console.log(`[socket] ${socket.user.name} left station room ${roomId}`);
      if (typeof callback === 'function') callback({ ok: true, room: roomId });
    });

    socket.on('system_alert', (data) => {
      if (socket.user.role !== 'admin') {
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
