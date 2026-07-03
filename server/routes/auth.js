const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { generateToken, authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── Security Middleware ───────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login requests per `window`
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each IP to 5 requests per hour
  message: { success: false, message: 'Too many password reset requests. Please try again later.' },
});

// ─── POST /api/auth/login ──────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: email.trim().toLowerCase() },
          { username: email.trim() },
        ],
      },
    });

    if (!user) {
      // Intentionally vague — don't confirm whether email exists
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Account has been suspended by Admin.' });
    }
    if (user.status === 'banned') {
      return res.status(403).json({ success: false, message: 'This account has been permanently banned.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials or role mismatch.' });
    }

    const token = generateToken(user);
    const { password: _, ...safeUser } = user;

    res.json({
      success: true,
      token,
      user: {
        ...safeUser,
        initials: user.name.substring(0, 2).toUpperCase(),
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { password: _, ...safeUser } = user;
    res.json({
      ...safeUser,
      initials: user.name.substring(0, 2).toUpperCase(),
    });
  } catch (err) {
    console.error('Auth/me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PUT /api/auth/onboarding ──────────────────────────────────
// First-time doctor profile setup — collects all essential data
router.put('/onboarding', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.role !== 'dentist') {
      return res.status(403).json({ success: false, message: 'Onboarding is only for dentist accounts.' });
    }

    const {
      name, phone, licenseNumber,
      clinic, clinicAddress, clinicCity, clinicState, clinicPinCode,
      scannerModel,
      shippingAddress, shippingCity, shippingState, shippingPinCode,
      preferredCourier, preferredContact,
      newPassword,
    } = req.body;

    // ─── Validation ──────────────────────────────────────────
    const errors = [];
    if (!name || !name.trim()) errors.push('Full name is required.');
    if (!phone || !phone.trim()) errors.push('Phone number is required.');
    if (!licenseNumber || !licenseNumber.trim()) errors.push('Dental license/registration number is required.');
    if (!clinic || !clinic.trim()) errors.push('Clinic name is required.');
    if (!clinicAddress || !clinicAddress.trim()) errors.push('Clinic address is required.');
    if (!clinicCity || !clinicCity.trim()) errors.push('Clinic city is required.');
    if (!clinicState || !clinicState.trim()) errors.push('Clinic state is required.');
    if (!clinicPinCode || !clinicPinCode.trim()) errors.push('Clinic PIN code is required.');
    if (!newPassword || newPassword.length < 8) errors.push('Password must be at least 8 characters.');

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors.join(' ') });
    }

    // ─── Hash the new password ───────────────────────────────
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // ─── Update the user profile ─────────────────────────────
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: name.trim(),
        phone: phone.trim(),
        licenseNumber: licenseNumber.trim(),
        clinic: clinic.trim(),
        clinicAddress: clinicAddress.trim(),
        clinicCity: clinicCity.trim(),
        clinicState: clinicState.trim(),
        clinicPinCode: clinicPinCode.trim(),
        scannerModel: scannerModel || 'none',
        shippingAddress: shippingAddress?.trim() || null,
        shippingCity: shippingCity?.trim() || null,
        shippingState: shippingState?.trim() || null,
        shippingPinCode: shippingPinCode?.trim() || null,
        preferredCourier: preferredCourier || 'delhivery',
        preferredContact: preferredContact || 'email',
        password: hashedPassword,
        onboardingComplete: true,
      },
    });

    const { password: __, ...safeUpdated } = updatedUser;
    res.json({
      success: true,
      user: {
        ...safeUpdated,
        initials: updatedUser.name.substring(0, 2).toUpperCase(),
      },
    });
  } catch (err) {
    console.error('Onboarding error:', err);
    res.status(500).json({ success: false, message: 'Server error during onboarding.' });
  }
});

// ─── PUT /api/auth/password ────────────────────────────────────
router.put('/password', authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Incorrect current password' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

    res.json({ success: true });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── PATCH /api/auth/onboarding-state ─────────────────────────
// Fire-and-forget update for signup welcome / coach tour progress
router.patch('/onboarding-state', authenticate, async (req, res) => {
  try {
    const allowed = [
      'welcomeCompleted', 'welcomeLastStep',
      'newCaseTourCompleted', 'deepDiveOpenedCount',
    ];

    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        data[key] = req.body[key];
      }
    }

    // Auto-set timestamps when booleans flip to true
    if (data.welcomeCompleted === true) {
      data.welcomeCompletedAt = new Date();
    }
    if (data.newCaseTourCompleted === true) {
      data.newCaseTourCompletedAt = new Date();
    }

    if (Object.keys(data).length === 0) {
      return res.json({ success: true }); // Nothing to update
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Onboarding state update error:', err);
    // Fire-and-forget — always return 200 so client never blocks
    res.json({ success: false });
  }
});

// ─── POST /api/auth/forgot-password ────────────────────────────
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

    const user = await prisma.user.findFirst({
      where: { email: email.trim().toLowerCase() }
    });

    if (!user) {
      // Intentionally vague for security
      return res.json({ success: true, message: 'If that email exists, a reset link has been generated.' });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 3600000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpiry: expiry }
    });

    // MOCK EMAIL SENDING
    const resetUrl = `http://localhost:5174/reset-password?token=${token}`;
    console.log('\n=========================================');
    console.log(`[EMAIL SIMULATION] Password Reset Request`);
    console.log(`To: ${user.email}`);
    console.log(`Link: ${resetUrl}`);
    console.log('=========================================\n');

    res.json({ success: true, message: 'If that email exists, a reset link has been generated.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST /api/auth/reset-password ─────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token and new password are required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() } // Must not be expired
      }
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null
      }
    });

    res.json({ success: true, message: 'Password has been successfully reset. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── PUT /api/auth/profile ─────────────────────────────────────
router.put('/profile', authenticate, async (req, res) => {
  try {
    const {
      name, phone, licenseNumber,
      clinic, clinicAddress, clinicCity, clinicState, clinicPinCode,
      scannerModel,
      shippingAddress, shippingCity, shippingState, shippingPinCode,
      preferredCourier, preferredContact,
      notificationPreferences
    } = req.body;

    const updateData = {
      name: name?.trim(),
      phone: phone?.trim(),
      licenseNumber: licenseNumber?.trim(),
      clinic: clinic?.trim(),
      clinicAddress: clinicAddress?.trim(),
      clinicCity: clinicCity?.trim(),
      clinicState: clinicState?.trim(),
      clinicPinCode: clinicPinCode?.trim(),
      scannerModel: scannerModel,
      shippingAddress: shippingAddress?.trim(),
      shippingCity: shippingCity?.trim(),
      shippingState: shippingState?.trim(),
      shippingPinCode: shippingPinCode?.trim(),
      preferredCourier: preferredCourier,
      preferredContact: preferredContact,
    };

    if (notificationPreferences !== undefined) {
      updateData.notificationPreferences = typeof notificationPreferences === 'string' ? notificationPreferences : JSON.stringify(notificationPreferences);
    }

    // Remove undefined fields so we don't accidentally blank them out
    Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
    });

    const { password: _, ...safeUser } = updatedUser;
    res.json({
      success: true,
      user: {
        ...safeUser,
        initials: updatedUser.name.substring(0, 2).toUpperCase()
      }
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ success: false, message: 'Server error during profile update.' });
  }
});

module.exports = router;

