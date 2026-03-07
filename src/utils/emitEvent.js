const emit = (req, event, data, rooms = []) => {
  const io = req.app.get('io');
  if (!io) return;

  if (rooms.length === 0) {
    io.emit(event, data);
  } else {
    for (const room of rooms) {
      io.to(room).emit(event, data);
    }
  }
};

module.exports = emit;
