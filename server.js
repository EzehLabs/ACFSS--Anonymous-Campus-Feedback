const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const DATABASE_PATH = path.resolve(
  process.env.DATABASE_PATH || path.join(__dirname, 'complaints.db')
);
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_FROM = process.env.SMTP_FROM || process.env.SMTP_USER;
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'ezehfranklin17@gmail.com').trim().toLowerCase();
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
const LEGACY_SUPER_ADMIN_EMAIL = 'ezehfranklin@futo.edu.ng';
const mailTransporter = process.env.SMTP_HOST && process.env.SMTP_USER &&
  process.env.SMTP_PASS && SMTP_FROM
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true' || SMTP_PORT === 465,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  : null;
const OTP_LIFETIME_MS = 10 * 60 * 1000;
const OTP_RESEND_WAIT_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Database initialization
const db = new sqlite3.Database(DATABASE_PATH, (err) => {
  if (err) console.error('Database error:', err);
  else console.log('Connected to SQLite database');
});

// Create tables
db.serialize(() => {
  // Admins table
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      can_create_admins INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Complaints table
  db.run(`
    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_code TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'Unreviewed',
      priority TEXT DEFAULT 'Medium',
      sentiment TEXT DEFAULT 'Neutral',
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_preferences (
      admin_id INTEGER PRIMARY KEY,
      theme TEXT NOT NULL DEFAULT 'light',
      accent TEXT NOT NULL DEFAULT 'orange',
      density TEXT NOT NULL DEFAULT 'comfortable',
      avatar_data_url TEXT
    )
  `, (err) => {
    if (err) console.error('Error creating admin preferences table:', err);
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_login_otps (
      admin_id INTEGER PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    )
  `, (err) => {
    if (err) console.error('Error creating admin login OTP table:', err);
  });

  initializeSuperAdmin();
});

function initializeSuperAdmin() {
  if (!SUPER_ADMIN_PASSWORD) {
    console.error('Super admin credentials are not configured. Set SUPER_ADMIN_PASSWORD in the environment.');
    return;
  }

  db.get('SELECT * FROM admins WHERE email = ?', [LEGACY_SUPER_ADMIN_EMAIL], (err, legacyAdmin) => {
    if (err) {
      console.error('Error checking legacy super admin account:', err);
      return;
    }

    db.get('SELECT id FROM admins WHERE email = ?', [SUPER_ADMIN_EMAIL], (lookupErr, configuredAdmin) => {
      if (lookupErr) {
        console.error('Error checking configured super admin account:', lookupErr);
        return;
      }

      if (configuredAdmin) {
        const hashedPassword = bcrypt.hashSync(SUPER_ADMIN_PASSWORD, 10);
        db.run(
          'UPDATE admins SET password = ?, can_create_admins = 1 WHERE id = ?',
          [hashedPassword, configuredAdmin.id],
          (updateErr) => {
            if (updateErr) {
              console.error('Error updating configured super admin credentials:', updateErr);
              return;
            }

            if (legacyAdmin && legacyAdmin.id !== configuredAdmin.id) {
              db.run(
                'UPDATE admins SET can_create_admins = 0 WHERE id = ?',
                [legacyAdmin.id],
                (demoteErr) => {
                  if (demoteErr) console.error('Error removing legacy super admin privileges:', demoteErr);
                  else console.log('Configured super admin credentials updated; legacy account demoted.');
                }
              );
              return;
            }

            console.log('Configured super admin credentials updated.');
          }
        );
        return;
      }

      if (legacyAdmin) {
        const hashedPassword = bcrypt.hashSync(SUPER_ADMIN_PASSWORD, 10);
        db.run(
          'UPDATE admins SET email = ?, password = ?, can_create_admins = 1 WHERE id = ?',
          [SUPER_ADMIN_EMAIL, hashedPassword, legacyAdmin.id],
          (updateErr) => {
            if (updateErr) console.error('Error migrating legacy super admin credentials:', updateErr);
            else console.log('Super admin credentials migrated from the legacy account.');
          }
        );
        return;
      }

      const hashedPassword = bcrypt.hashSync(SUPER_ADMIN_PASSWORD, 10);
      db.run(
        'INSERT INTO admins (email, password, name, can_create_admins) VALUES (?, ?, ?, ?)',
        [SUPER_ADMIN_EMAIL, hashedPassword, 'Ezeh Franklin', 1],
        (insertErr) => {
          if (insertErr) console.error('Error creating super admin:', insertErr);
          else console.log('Super admin created successfully.');
        }
      );
    });
  });
}

// Helper function to generate reference code
function generateReferenceCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'FUTO';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Helper function to verify JWT
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.adminId = decoded.id;
    req.adminEmail = decoded.email;
    req.canCreateAdmins = decoded.can_create_admins;
    next();
  });
}

function createAdminToken(admin) {
  return jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      can_create_admins: admin.can_create_admins
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function maskEmail(email) {
  const [name, domain] = email.split('@');
  if (!domain) return 'your registered email address';
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(name.length - 1, 3))}@${domain}`;
}

function hashLoginOtp(adminId, code) {
  return crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${adminId}:${code}`)
    .digest('hex');
}

// ============ AUTHENTICATION ROUTES ============

// Verify admin password and send an email OTP
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  db.get('SELECT * FROM admins WHERE LOWER(email) = ?', [normalizedEmail], (err, admin) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    if (!bcrypt.compareSync(password, admin.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!mailTransporter) {
      return res.status(503).json({
        error: 'Email verification is not configured. Set the SMTP environment variables before signing in.'
      });
    }

    const now = Date.now();
    db.get(
      'SELECT created_at FROM admin_login_otps WHERE admin_id = ?',
      [admin.id],
      (otpErr, existingOtp) => {
        if (otpErr) {
          return res.status(500).json({ error: 'Unable to start email verification' });
        }

        const retryAfter = existingOtp
          ? OTP_RESEND_WAIT_MS - (now - existingOtp.created_at)
          : 0;
        if (retryAfter > 0) {
          return res.status(429).json({
            error: 'A verification code was recently sent. Please wait before requesting another.',
            retry_after_seconds: Math.ceil(retryAfter / 1000)
          });
        }

        const code = crypto.randomInt(100000, 1000000).toString();
        const codeHash = hashLoginOtp(admin.id, code);
        db.run(
          `INSERT INTO admin_login_otps (admin_id, code_hash, expires_at, created_at, attempts)
           VALUES (?, ?, ?, ?, 0)
           ON CONFLICT(admin_id) DO UPDATE SET
             code_hash = excluded.code_hash,
             expires_at = excluded.expires_at,
             created_at = excluded.created_at,
             attempts = 0`,
          [admin.id, codeHash, now + OTP_LIFETIME_MS, now],
          (saveErr) => {
            if (saveErr) {
              return res.status(500).json({ error: 'Unable to start email verification' });
            }

            mailTransporter.sendMail({
              from: SMTP_FROM,
              to: admin.email,
              subject: 'Your ACFSS admin sign-in code',
              text: `Your ACFSS verification code is ${code}. It expires in 10 minutes. If you did not try to sign in, you can ignore this email.`,
              html: `<p>Your ACFSS verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not try to sign in, you can ignore this email.</p>`
            }).then(() => {
              res.json({
                success: true,
                otp_required: true,
                message: 'A verification code was sent to your registered email address.',
                email: maskEmail(admin.email)
              });
            }).catch((mailErr) => {
              console.error('Failed to send admin login OTP:', mailErr);
              db.run('DELETE FROM admin_login_otps WHERE admin_id = ?', [admin.id], (deleteErr) => {
                if (deleteErr) console.error('Failed to clear unsent admin login OTP:', deleteErr);
              });
              res.status(503).json({ error: 'Could not send the verification email. Please try again later.' });
            });
          }
        );
      }
    );
  });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code } = req.body;
  if (!email || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the 6-digit verification code.' });
  }

  db.get(
    `SELECT admins.*, admin_login_otps.code_hash, admin_login_otps.expires_at,
            admin_login_otps.attempts
     FROM admins
     JOIN admin_login_otps ON admin_login_otps.admin_id = admins.id
     WHERE admins.email = ?`,
    [email],
    (err, admin) => {
      if (err) return res.status(500).json({ error: 'Unable to verify code' });
      if (!admin) return res.status(401).json({ error: 'Verification code is invalid or expired.' });

      if (admin.expires_at <= Date.now()) {
        return db.run('DELETE FROM admin_login_otps WHERE admin_id = ?', [admin.id], (deleteErr) => {
          if (deleteErr) return res.status(500).json({ error: 'Unable to verify code' });
          res.status(401).json({ error: 'Verification code expired. Sign in again to get a new code.' });
        });
      }

      if (admin.attempts >= OTP_MAX_ATTEMPTS) {
        return res.status(429).json({ error: 'Too many incorrect codes. Sign in again to request a new code.' });
      }

      const submittedHash = Buffer.from(hashLoginOtp(admin.id, code), 'hex');
      const savedHash = Buffer.from(admin.code_hash, 'hex');
      if (!crypto.timingSafeEqual(submittedHash, savedHash)) {
        const attempts = admin.attempts + 1;
        return db.run(
          'UPDATE admin_login_otps SET attempts = ? WHERE admin_id = ?',
          [attempts, admin.id],
          (updateErr) => {
            if (updateErr) return res.status(500).json({ error: 'Unable to verify code' });
            const remaining = OTP_MAX_ATTEMPTS - attempts;
            res.status(401).json({
              error: remaining > 0
                ? `Verification code is incorrect. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
                : 'Too many incorrect codes. Sign in again to request a new code.'
            });
          }
        );
      }

      db.run('DELETE FROM admin_login_otps WHERE admin_id = ?', [admin.id], (deleteErr) => {
        if (deleteErr) return res.status(500).json({ error: 'Unable to complete sign in' });

        res.json({
          success: true,
          token: createAdminToken(admin),
          admin: {
            id: admin.id,
            email: admin.email,
            name: admin.name,
            can_create_admins: admin.can_create_admins === 1
          }
        });
      });
    }
  );
});

// Create new admin (only super admin can do this)
app.post('/api/auth/create-admin', verifyToken, (req, res) => {
  const { email, password, name } = req.body;

  // Check if current user is super admin
  if (!req.canCreateAdmins) {
    return res.status(403).json({ error: 'You do not have permission to create admins' });
  }

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name required' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);

  db.run(
    'INSERT INTO admins (email, password, name, can_create_admins) VALUES (?, ?, ?, ?)',
    [email, hashedPassword, name, 0],
    (err) => {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({ success: true, message: 'Admin created successfully' });
    }
  );
});

// ============ COMPLAINT ROUTES ============

app.get('/api/admin/preferences', verifyToken, (req, res) => {
  db.get(
    'SELECT theme, accent, density, avatar_data_url FROM admin_preferences WHERE admin_id = ?',
    [req.adminId],
    (err, preferences) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to load dashboard preferences' });
      }

      res.json({
        success: true,
        preferences: preferences || {
          theme: 'light',
          accent: 'orange',
          density: 'comfortable',
          avatar_data_url: null
        }
      });
    }
  );
});

app.put('/api/admin/preferences', verifyToken, (req, res) => {
  const { theme, accent, density, avatar_data_url: avatarDataUrl } = req.body;
  const validThemes = ['light', 'dark'];
  const validAccents = ['orange', 'blue', 'violet', 'green'];
  const validDensities = ['comfortable', 'compact'];
  const validAvatar = avatarDataUrl === null || (
    typeof avatarDataUrl === 'string' &&
    avatarDataUrl.length <= 85000 &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatarDataUrl)
  );

  if (
    !validThemes.includes(theme) ||
    !validAccents.includes(accent) ||
    !validDensities.includes(density) ||
    !validAvatar
  ) {
    return res.status(400).json({ error: 'Invalid dashboard preferences' });
  }

  db.run(
    `INSERT INTO admin_preferences (admin_id, theme, accent, density, avatar_data_url)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(admin_id) DO UPDATE SET
       theme = excluded.theme,
       accent = excluded.accent,
       density = excluded.density,
       avatar_data_url = excluded.avatar_data_url`,
    [req.adminId, theme, accent, density, avatarDataUrl],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to save dashboard preferences' });
      }

      res.json({ success: true, message: 'Dashboard preferences saved' });
    }
  );
});

// Submit complaint
app.post('/api/complaints/submit', (req, res) => {
  const { category, content } = req.body;

  if (!category || !content) {
    return res.status(400).json({ error: 'Category and content required' });
  }

  const referenceCode = generateReferenceCode();

  db.run(
    'INSERT INTO complaints (reference_code, category, content) VALUES (?, ?, ?)',
    [referenceCode, category, content],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to submit complaint' });
      }

      res.json({
        success: true,
        message: 'Complaint submitted successfully',
        reference_code: referenceCode
      });
    }
  );
});

// Get all complaints (admin only)
app.get('/api/complaints', verifyToken, (req, res) => {
  db.all(
    'SELECT * FROM complaints ORDER BY submitted_at DESC',
    [],
    (err, complaints) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        success: true,
        complaints: complaints || []
      });
    }
  );
});

// Get complaint by reference code
app.get('/api/complaints/:referenceCode', (req, res) => {
  const { referenceCode } = req.params;

  db.get(
    'SELECT * FROM complaints WHERE reference_code = ?',
    [referenceCode],
    (err, complaint) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!complaint) {
        return res.status(404).json({ error: 'Complaint not found' });
      }

      res.json({
        success: true,
        complaint
      });
    }
  );
});

// Update complaint status (admin only)
app.patch('/api/complaints/:id/status', verifyToken, (req, res) => {
  const { id } = req.params;
  const { status, priority, sentiment } = req.body;

  let updateQuery = 'UPDATE complaints SET ';
  const updateValues = [];

  if (status) {
    updateQuery += 'status = ?, ';
    updateValues.push(status);
  }
  if (priority) {
    updateQuery += 'priority = ?, ';
    updateValues.push(priority);
  }
  if (sentiment) {
    updateQuery += 'sentiment = ?, ';
    updateValues.push(sentiment);
  }

  // Remove trailing comma and space
  updateQuery = updateQuery.slice(0, -2);
  updateQuery += ' WHERE id = ?';
  updateValues.push(id);

  db.run(updateQuery, updateValues, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({ success: true, message: 'Complaint updated' });
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set a different PORT or stop the process using this port.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) console.error('Error closing database:', err);
    else console.log('Database closed');
    process.exit(0);
  });
});