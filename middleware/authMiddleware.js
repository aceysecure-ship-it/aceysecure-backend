const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Checks the "Authorization: Bearer <token>" header and loads the user.
const protect = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized. Please log in.' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set');
    return res.status(500).json({ message: 'Server is not configured correctly.' });
  }

  try {
    const token = header.slice(7).trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ message: 'Not authorized. Please log in again.' });

    req.user = user;
    next();
  } catch (error) {
    if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) {
      return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
    }
    console.error('protect middleware error:', error);
    res.status(500).json({ message: 'Server error while checking your login.' });
  }
};

// Use AFTER protect: lets only admins through.
const admin = (req, res, next) => {
  if (req.user && req.user.isAdmin) return next();
  res.status(403).json({ message: 'Admins only.' });
};

module.exports = { protect, admin };
