const jwt = require('jsonwebtoken');
const env = require('../config/env');
const Worker = require('../models/Worker');
const { success, fail } = require('../utils/response');

const signToken = (id) => {
  return jwt.sign({ id }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
};

exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.validated.body;

    const worker = await Worker.findOne({ username }).select('+password').populate('role');
    if (!worker || !(await worker.comparePassword(password))) {
      return fail(res, 'Invalid username or password', 401);
    }

    const token = signToken(worker._id);

    success(res, { token, worker }, 'Login successful');
  } catch (err) {
    next(err);
  }
};

exports.logout = async (req, res) => {
  success(res, null, 'Logged out successfully');
};

exports.getMe = async (req, res) => {
  success(res, req.user);
};

exports.updateMe = async (req, res, next) => {
  try {
    const { name, username, notificationPreferences } = req.validated.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (username !== undefined) updates.username = username;
    if (notificationPreferences !== undefined) {
      for (const [key, value] of Object.entries(notificationPreferences)) {
        updates[`notificationPreferences.${key}`] = value;
      }
    }

    const worker = await Worker.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    }).populate('role');

    success(res, worker, 'Profile updated');
  } catch (err) {
    next(err);
  }
};
