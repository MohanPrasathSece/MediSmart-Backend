const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// @route   POST /api/auth/register
// @desc    Register user
// @access  Public
router.post('/register', [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').matches(/^[0-9]{10}$/).withMessage('Please enter a valid 10-digit phone number'),
  body('role').isIn(['patient', 'pharmacy', 'delivery_boy']).withMessage('Invalid role')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { name, email, password, phone, role, address, pharmacyDetails, deliveryDetails, patientDetails } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { phone }] 
    });

    if (existingUser) {
      return res.status(400).json({ 
        message: 'User already exists with this email or phone number' 
      });
    }

    // Create user object
    const userData = {
      name,
      email,
      password,
      phone,
      role,
      address
    };

    // Add role-specific data
    if (role === 'pharmacy' && pharmacyDetails) {
      userData.pharmacyDetails = pharmacyDetails;
    } else if (role === 'delivery_boy' && deliveryDetails) {
      userData.deliveryDetails = deliveryDetails;
    } else if (role === 'patient' && patientDetails) {
      userData.patientDetails = patientDetails;
    }

    const user = new User(userData);
    // Final guard: never persist coordinates if it's undefined
    if (user.address && user.address.coordinates === undefined) {
      delete user.address.coordinates;
    }

    await user.save();

    const token = generateToken(user._id);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('password').exists().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { email, password } = req.body;

    // Find user and include password for comparison
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(400).json({ message: 'Account is deactivated' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        address: user.address,
        profileImage: user.profileImage
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', auth, [
  body('name').optional().trim().isLength({ min: 2, max: 50 }),
  body('phone').optional().matches(/^[0-9]{10}$/),
  body('address.street').optional().trim(),
  body('address.city').optional().trim(),
  body('address.state').optional().trim(),
  body('address.zipCode').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const updates = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update basic fields
    if (updates.name) user.name = updates.name;
    if (updates.phone) user.phone = updates.phone;
    if (updates.profileImage) user.profileImage = updates.profileImage;

    // Update address (safely handle coordinates)
    if (updates.address) {
      const currentAddr = user.address && typeof user.address === 'object' ? user.address : {};
      const { coordinates: coordsUpdate, ...restAddr } = updates.address || {};
      // Debug: trace incoming address
      // console.log('Incoming address update:', JSON.stringify(updates.address));

      // Ensure address object exists
      if (!user.address || typeof user.address !== 'object') {
        user.address = {};
      }

      // Assign simple address fields individually
      for (const [k, v] of Object.entries(restAddr)) {
        if (v !== undefined) {
          user.address[k] = v;
        }
      }

      // Handle coordinates only if valid numbers are provided
      if (coordsUpdate && (coordsUpdate.latitude !== undefined || coordsUpdate.longitude !== undefined)) {
        const latVal = coordsUpdate.latitude !== undefined ? Number(coordsUpdate.latitude) : undefined;
        const lngVal = coordsUpdate.longitude !== undefined ? Number(coordsUpdate.longitude) : undefined;
        const hasLat = Number.isFinite(latVal);
        const hasLng = Number.isFinite(lngVal);
        if (hasLat || hasLng) {
          if (!user.address.coordinates || typeof user.address.coordinates !== 'object') {
            user.address.coordinates = {};
          }
          if (hasLat) user.address.coordinates.latitude = latVal;
          if (hasLng) user.address.coordinates.longitude = lngVal;
        }
      }
      // If coordinates key was provided but invalid/undefined, do not touch existing coordinates and never set undefined
    }

    // Update role-specific details
    if (user.role === 'pharmacy' && updates.pharmacyDetails) {
      user.pharmacyDetails = { ...user.pharmacyDetails, ...updates.pharmacyDetails };
    } else if (user.role === 'delivery_boy' && updates.deliveryDetails) {
      user.deliveryDetails = { ...user.deliveryDetails, ...updates.deliveryDetails };
    } else if (user.role === 'patient' && updates.patientDetails) {
      user.patientDetails = { ...user.patientDetails, ...updates.patientDetails };
    }

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Server error during profile update' });
  }
});

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put('/change-password', auth, [
  body('currentPassword').exists().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ message: 'Server error during password change' });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', auth, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
