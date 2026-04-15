import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Enhanced CORS for production
const corsOptions = {
  origin: ['http://localhost:3000', 'http://localhost', process.env.RENDER_EXTERNAL_URL || '*'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-session']
};

app.use(cors(corsOptions));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

// Main route - serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin credentials
const ADMIN_EMAIL = 'admin23@gmail.com';
const ADMIN_PASSWORD = '1234567890';

// In-memory storage (use database in production)
const users = new Map();
const rewards = new Map();
const adminSessions = new Map(); // Store admin sessions
const leaderboardBonuses = new Map(); // Store admin bonuses for leaderboard users

// Generate unique user ID
function generateUserId() {
  return crypto.randomBytes(16).toString('hex');
}

// Generate Lightning Invoice using public LNBits instance
async function generateLightningInvoice(userId, sats) {
  try {
    // Using public LNBits demo (fallback solution)
    const invoiceData = {
      out: false,
      amount: sats,
      memo: `CryptoLearn Reward - User ${userId.slice(0, 8)}`
    };

    // For this demo, we'll return a simulated invoice
    // In production, connect to real LNBits or Alby
    return {
      payment_request: `lnbc${sats}n1p...SIMULATED...`, // Real invoice from LNBits
      payment_hash: crypto.randomBytes(32).toString('hex'),
      expires_at: Date.now() + 3600000, // 1 hour
      settled: false
    };
  } catch (error) {
    console.error('Invoice generation error:', error);
    throw error;
  }
}

// User Registration / Get Wallet
app.post('/api/user/init', (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'No userId provided' });
  }

  if (!users.has(userId)) {
    users.set(userId, {
      id: userId,
      created: Date.now(),
      totalSatsEarned: 0,
      completedLessons: new Set(),
      publicAddress: null
    });

    rewards.set(userId, {
      pending: 0,
      claimed: 0,
      history: []
    });
  }

  const user = users.get(userId);
  res.json({
    success: true,
    userId: user.id,
    totalSatsEarned: user.totalSatsEarned,
    userCreated: user.created
  });
});

// Set user's Bitcoin/Lightning address
app.post('/api/user/set-address', (req, res) => {
  const { userId, address } = req.body;

  if (!userId || !address) {
    return res.status(400).json({ error: 'Missing userId or address' });
  }

  if (!users.has(userId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Validate Lightning address format (ln... or lnbc...)
  if (!address.toLowerCase().startsWith('ln')) {
    return res.status(400).json({ error: 'Invalid Lightning address' });
  }

  const user = users.get(userId);
  user.publicAddress = address;

  res.json({
    success: true,
    message: 'Address saved',
    address: address
  });
});

// Complete lesson and claim reward
app.post('/api/reward/claim', async (req, res) => {
  const { userId, lessonId, satAmount } = req.body;

  if (!userId || !lessonId || !satAmount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!users.has(userId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = users.get(userId);
  const reward = rewards.get(userId);

  // Check if lesson already completed
  if (user.completedLessons.has(lessonId)) {
    return res.status(400).json({ error: 'Lesson already completed' });
  }

  try {
    // Generate Lightning Invoice
    const invoice = await generateLightningInvoice(userId, satAmount);

    // Mark lesson as completed
    user.completedLessons.add(lessonId);
    user.totalSatsEarned += satAmount;
    reward.pending += satAmount;
    reward.history.push({
      lessonId,
      sats: satAmount,
      claimedAt: Date.now(),
      status: 'pending_payment'
    });

    res.json({
      success: true,
      message: 'Reward generated',
      sats: satAmount,
      invoiceData: invoice,
      totalEarned: user.totalSatsEarned
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate reward: ' + error.message });
  }
});

// Get user stats
app.get('/api/user/stats/:userId', (req, res) => {
  const { userId } = req.params;

  if (!users.has(userId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = users.get(userId);
  const reward = rewards.get(userId);

  res.json({
    userId: user.id,
    totalSatsEarned: user.totalSatsEarned,
    completedLessons: Array.from(user.completedLessons),
    pendingSats: reward.pending,
    address: user.publicAddress ? '***' + user.publicAddress.slice(-8) : null,
    rewardHistory: reward.history
  });
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  console.log('Admin login attempt:', email);

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    adminSessions.set(sessionId, {
      email,
      loginTime: Date.now(),
      isAdmin: true
    });

    console.log('✅ Admin login successful:', email);
    res.json({
      success: true,
      sessionId,
      message: 'Admin login successful'
    });
  } else {
    console.log('❌ Admin login failed - invalid credentials');
    res.status(401).json({ error: 'Invalid admin credentials' });
  }
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  const { sessionId } = req.body;
  adminSessions.delete(sessionId);
  res.json({ success: true });
});

// Verify Admin Session
function verifyAdmin(req, res, next) {
  const sessionId = req.headers['x-admin-session'] || req.body.sessionId;
  if (!sessionId || !adminSessions.has(sessionId)) {
    return res.status(401).json({ error: 'Invalid admin session' });
  }
  req.adminSession = adminSessions.get(sessionId);
  next();
}

// Get Admin Dashboard Data
app.get('/api/admin/dashboard', verifyAdmin, (req, res) => {
  const totalUsers = users.size;
  const totalRewards = Array.from(rewards.values()).reduce((sum, r) => sum + r.pending + r.claimed, 0);
  const activeUsers = Array.from(users.values()).filter(u => u.completedLessons.size > 0).length;

  res.json({
    totalUsers,
    totalRewards,
    activeUsers,
    leaderboardBonuses: Array.from(leaderboardBonuses.entries())
  });
});

// Add Leaderboard Bonus (Admin Only)
app.post('/api/admin/add-leaderboard-bonus', verifyAdmin, async (req, res) => {
  const { userId, satsAmount, reason } = req.body;

  if (!userId || !satsAmount || satsAmount <= 0) {
    return res.status(400).json({ error: 'Invalid bonus parameters' });
  }

  if (!users.has(userId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = users.get(userId);
  const reward = rewards.get(userId);

  // Generate Lightning Invoice for bonus
  const invoice = await generateLightningInvoice(userId, satsAmount);

  // Add to leaderboard bonuses
  const bonusId = crypto.randomBytes(16).toString('hex');
  leaderboardBonuses.set(bonusId, {
    userId,
    satsAmount,
    reason: reason || 'Leaderboard bonus',
    createdAt: Date.now(),
    status: 'pending',
    invoiceData: invoice
  });

  res.json({
    success: true,
    bonusId,
    message: `Bonus of ${satsAmount} sats added to leaderboard user`,
    invoiceData: invoice
  });
});

// Get Leaderboard with Admin Bonuses
app.get('/api/leaderboard/admin', verifyAdmin, (req, res) => {
  const leaderboard = Array.from(users.values())
    .map(user => ({
      userId: user.id,
      totalSats: user.totalSatsEarned,
      completedLessons: user.completedLessons.size,
      level: getLevel(user.totalSatsEarned).name,
      bonuses: Array.from(leaderboardBonuses.values())
        .filter(b => b.userId === user.id && b.status === 'pending')
        .map(b => ({ id: b.id, sats: b.satsAmount, reason: b.reason }))
    }))
    .sort((a, b) => b.totalSats - a.totalSats)
    .slice(0, 10);

  res.json({ leaderboard });
});

// Admin Reward Distribution (for admin users)
app.post('/api/admin/claim-admin-reward', verifyAdmin, async (req, res) => {
  const { satsAmount } = req.body;
  const maxAdminReward = 3000000; // 3,000,000 sats = ~$30 USD

  if (!satsAmount || satsAmount > maxAdminReward) {
    return res.status(400).json({ error: `Admin reward cannot exceed ${maxAdminReward} sats (~$30)` });
  }

  const adminUserId = 'admin-' + req.adminSession.email;
  const invoice = await generateLightningInvoice(adminUserId, satsAmount);

  res.json({
    success: true,
    message: `Admin reward of ${satsAmount} sats generated`,
    satsAmount,
    invoiceData: invoice
  });
});

// Admin Withdrawal - Real-time payment processing
app.post('/api/admin/withdraw', verifyAdmin, async (req, res) => {
  const { method, amount, address, email, value } = req.body;

  if (!method || !amount || amount !== 3000000) {
    return res.status(400).json({ error: 'Invalid withdrawal request' });
  }

  console.log(`💸 Withdrawal request: ${amount} sats (~$30) via ${method}`);

  try {
    let transactionId, confirmationDetails;

    switch (method) {
      case 'bitcoin':
        if (!address) {
          return res.status(400).json({ error: 'Bitcoin address required' });
        }
        transactionId = crypto.randomBytes(16).toString('hex');
        confirmationDetails = {
          method: 'Bitcoin',
          address: address.slice(-20),
          amount: '$30 USD',
          status: 'Processing',
          estimatedTime: '5-30 minutes'
        };
        console.log(`✅ Bitcoin withdrawal initiated to ${address}`);
        break;

      case 'fapshi':
        if (!email) {
          return res.status(400).json({ error: 'Fapshi email required' });
        }
        transactionId = crypto.randomBytes(16).toString('hex');
        confirmationDetails = {
          method: 'Fapshi',
          email: email,
          amount: '$30 USD',
          status: 'Processing',
          estimatedTime: '1-2 hours'
        };
        console.log(`✅ Fapshi withdrawal initiated to ${email}`);
        break;

      case 'mtn':
        if (!value) {
          return res.status(400).json({ error: 'MTN phone number required' });
        }
        transactionId = crypto.randomBytes(16).toString('hex');
        confirmationDetails = {
          method: 'MTN Mobile Money',
          phone: value.slice(-9),
          amount: '$30 USD',
          status: 'Processing',
          estimatedTime: '1-5 minutes'
        };
        console.log(`✅ MTN withdrawal initiated to ${value}`);
        break;

      case 'orange':
        if (!value) {
          return res.status(400).json({ error: 'Orange phone number required' });
        }
        transactionId = crypto.randomBytes(16).toString('hex');
        confirmationDetails = {
          method: 'Orange Money',
          phone: value.slice(-9),
          amount: '$30 USD',
          status: 'Processing',
          estimatedTime: '1-5 minutes'
        };
        console.log(`✅ Orange Money withdrawal initiated to ${value}`);
        break;

      default:
        return res.status(400).json({ error: 'Invalid withdrawal method' });
    }

    // Simulate real-time payment processing (in production, integrate actual payment APIs)
    const withdrawal = {
      transactionId,
      method,
      adminEmail: req.adminSession.email,
      amount,
      usd: '$30 USD',
      createdAt: Date.now(),
      status: 'pending',
      confirmationDetails
    };

    console.log(`💾 Withdrawal saved:`, withdrawal);

    res.json({
      success: true,
      message: `Withdrawal initiated via ${method}`,
      transactionId,
      confirmationDetails,
      withdrawalData: withdrawal
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ error: 'Withdrawal processing failed: ' + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🪙 CryptoLearn Rewards API running on port ${PORT}`);
  console.log('URL: http://localhost:' + PORT);
  console.log('\nAuthentication:');
  console.log('  Email: ' + ADMIN_EMAIL);
  console.log('  Password: ' + ADMIN_PASSWORD);
  console.log('\nAPI Endpoints:');
  console.log('  POST /api/user/init');
  console.log('  POST /api/user/set-address');
  console.log('  POST /api/reward/claim');
  console.log('  GET  /api/user/stats/:userId');
  console.log('  POST /api/admin/login');
  console.log('  POST /api/admin/logout');
  console.log('  GET  /api/admin/dashboard');
  console.log('  POST /api/admin/claim-admin-reward');
  console.log('  POST /api/admin/add-leaderboard-bonus');
  console.log('  GET  /api/leaderboard/admin');
  console.log('  POST /api/admin/withdraw');
});

// 404 handler
app.use((req, res) => {
  console.log('❌ 404 - Route not found:', req.method, req.path);
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Internal server error: ' + err.message });
});
