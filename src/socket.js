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

  io.on('connection', (socket) => {
    console.log(`[socket] ${socket.user.name} connected (${socket.id})`);

    socket.join(`user:${socket.user._id}`);

    socket.on('disconnect', (reason) => {
      console.log(`[socket] ${socket.user.name} disconnected (${reason})`);
    });
  });

  return io;
};

module.exports = setupSocket;
