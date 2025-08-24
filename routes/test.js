const express = require('express');
const User = require('../models/User');
const router = express.Router();

// @route   POST /api/test/create-user
// @desc    Create a test user for debugging
// @access  Public
router.post('/create-user', async (req, res) => {
  try {
    const email = 'test@example.com';
    const password = 'password123';

    // Check if user already exists
    let user = await User.findOne({ email });

    if (user) {
      // If user exists, update their password to ensure it's correct
      user.password = password;
      await user.save();
      return res.status(200).json({ 
        message: 'Test user password has been reset.',
        email: email,
        password: password
      });
    } else {
      // If user does not exist, create a new one
      user = new User({
        name: 'Test User',
        email: email,
        password: password,
        phone: '1234567890',
        role: 'patient',
        isVerified: true
      });
      await user.save();
      return res.status(201).json({
        message: 'Test user created successfully.',
        email: email,
        password: password
      });
    }
  } catch (error) {
    console.error('Test user creation error:', error);
    res.status(500).json({ message: 'Server error during test user creation' });
  }
});

module.exports = router;
