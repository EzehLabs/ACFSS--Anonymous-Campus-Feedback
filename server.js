const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const nlp = require('compromise');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const DATABASE_PATH = path.resolve(
  process.env.DATABASE_PATH || path.join(__dirname, 'complaints.db')
);
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_FROM = process.env.SMTP_FROM || process.env.SMTP_USER;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM;
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'franklinezeh17@gmail.com').trim().toLowerCase();
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
const PII_NAME_BLOCKLIST = (process.env.PII_NAME_BLOCKLIST || '')
  .split(',')
  .map(name => name.trim().toLowerCase())
  .filter(Boolean);
const LEGACY_SUPER_ADMIN_EMAILS = [
  'ezehfranklin@futo.edu.ng',
  'ezehfranklin17@gmail.com'
];
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

  const legacyPlaceholders = LEGACY_SUPER_ADMIN_EMAILS.map(() => 'LOWER(email) = ?').join(' OR ');
  const legacyEmailParams = LEGACY_SUPER_ADMIN_EMAILS.map(email => email.toLowerCase());
  db.all(
    `SELECT id, email FROM admins WHERE ${legacyPlaceholders} ORDER BY id`,
    legacyEmailParams,
    (err, legacyAdmins) => {
      if (err) {
        console.error('Error checking previous super admin accounts:', err);
        return;
      }

      db.get('SELECT id FROM admins WHERE LOWER(email) = ?', [SUPER_ADMIN_EMAIL], (lookupErr, configuredAdmin) => {
        if (lookupErr) {
          console.error('Error checking configured super admin account:', lookupErr);
          return;
        }

        if (configuredAdmin) {
          const hashedPassword = bcrypt.hashSync(SUPER_ADMIN_PASSWORD, 10);
          db.run(
            'UPDATE admins SET email = ?, password = ?, can_create_admins = 1 WHERE id = ?',
            [SUPER_ADMIN_EMAIL, hashedPassword, configuredAdmin.id],
            (updateErr) => {
              if (updateErr) {
                console.error('Error updating configured super admin credentials:', updateErr);
                return;
              }

              const previousAccountIds = legacyAdmins
                .filter(admin => admin.id !== configuredAdmin.id)
                .map(admin => admin.id);
              if (previousAccountIds.length === 0) {
                console.log('Configured super admin credentials updated.');
                return;
              }

              const previousPlaceholders = previousAccountIds.map(() => '?').join(', ');
              db.run(
                `UPDATE admins SET can_create_admins = 0 WHERE id IN (${previousPlaceholders})`,
                previousAccountIds,
                (demoteErr) => {
                  if (demoteErr) console.error('Error removing previous super admin privileges:', demoteErr);
                  else console.log('Configured super admin credentials updated; previous account(s) demoted.');
                }
              );
            }
          );
          return;
        }

        if (legacyAdmins.length > 0) {
          const [accountToMigrate, ...accountsToDemote] = legacyAdmins;
          const hashedPassword = bcrypt.hashSync(SUPER_ADMIN_PASSWORD, 10);
          db.run(
            'UPDATE admins SET email = ?, password = ?, can_create_admins = 1 WHERE id = ?',
            [SUPER_ADMIN_EMAIL, hashedPassword, accountToMigrate.id],
            (updateErr) => {
              if (updateErr) {
                console.error('Error migrating previous super admin credentials:', updateErr);
                return;
              }

              if (accountsToDemote.length === 0) {
                console.log('Super admin credentials migrated from a previous account.');
                return;
              }

              const previousPlaceholders = accountsToDemote.map(() => '?').join(', ');
              db.run(
                `UPDATE admins SET can_create_admins = 0 WHERE id IN (${previousPlaceholders})`,
                accountsToDemote.map(admin => admin.id),
                (demoteErr) => {
                  if (demoteErr) console.error('Error removing previous super admin privileges:', demoteErr);
                  else console.log('Super admin credentials migrated; remaining previous account(s) demoted.');
                }
              );
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
    }
  );
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

function detectPersonalInformation(content) {
  const detected = new Set();
  const patterns = [
    {
      type: 'email address',
      regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
    },
    {
      type: 'phone number',
      regex: /(?<!\d)(?:\+?234|0)[\s().-]?(?:70|80|81|90|91)\d(?:[\s().-]?\d){7}(?!\d)|(?<!\d)0\d{10}(?!\d)|\+\d(?:[\s().-]?\d){8,14}(?!\d)/
    },
    {
      type: 'student registration number',
      regex: /(?<![A-Z0-9])(?:[A-Z]{2,6}[/\s-])?(?:FUTO[/\s-])?(?:19|20)\d{2}[/\s-](?:(?:[A-Z]{2,5}|\d{1,2})[/\s-])?\d{3,8}(?:[/\s-][A-Z0-9]{1,4})?(?![A-Z0-9])/i
    },
    {
      type: 'government identification number',
      regex: /\b(?:BVN|NIN|national identification number|social security number|SSN)\D{0,12}\d{11}\b/i
    },
    {
      type: 'date of birth',
      regex: /\b(?:date of birth|DOB)\D{0,5}\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}\b/i
    },
    {
      type: 'home address',
      regex: /\b(?:home address|residential address|my address is|i live at)\s*[:,-]?\s+[^,.!?]{8,80}/i
    }
  ];

  for (const { type, regex } of patterns) {
    if (regex.test(content)) detected.add(type);
  }

  const contextualNamePattern = /\b(?:my name is|name\s*[:=]|student(?:'s)? name\s*(?:is|:)|lecturer(?:'s)?(?: name)?\s*(?:is|:))\s+([A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*){0,2})\b/iu;
  const titledNamePattern = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Professor|Lecturer)\.?\s+[A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*){0,2}\b/u;
  const recognizedPeople = nlp(content).people().out('array');
  const containsConfiguredName = PII_NAME_BLOCKLIST.some(name => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}])${escapedName}(?=$|[^\\p{L}])`, 'iu').test(content);
  });
  if (
    recognizedPeople.length > 0 ||
    contextualNamePattern.test(content) ||
    titledNamePattern.test(content) ||
    containsConfiguredName
  ) {
    detected.add('person name');
  }

  return [...detected];
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

async function sendLoginOtpEmail(to, code) {
  const subject = 'Your ACFSS admin sign-in code';
  const text = `Your ACFSS verification code is ${code}. It expires in 10 minutes. If you did not try to sign in, you can ignore this email.`;
  const html = `<p>Your ACFSS verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not try to sign in, you can ignore this email.</p>`;

  if (RESEND_API_KEY) {
    if (!RESEND_FROM) {
      throw new Error('RESEND_FROM must be set to a verified sender address when using Resend.');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 500);
      throw new Error(`Resend API returned HTTP ${response.status}: ${responseBody}`);
    }
    return;
  }

  if (!mailTransporter) {
    throw new Error('No email provider is configured.');
  }

  await mailTransporter.sendMail({ from: SMTP_FROM, to, subject, text, html });
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

    if (normalizedEmail !== SUPER_ADMIN_EMAIL) {
      return res.json({
        success: true,
        otp_required: false,
        token: createAdminToken(admin),
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          can_create_admins: admin.can_create_admins === 1
        }
      });
    }

    if (RESEND_API_KEY && !RESEND_FROM) {
      return res.status(503).json({
        error: 'Email verification is not configured. Set RESEND_FROM to a verified sender address.'
      });
    }

    if (!RESEND_API_KEY && !mailTransporter) {
      return res.status(503).json({
        error: 'Email verification is not configured. Set RESEND_API_KEY and RESEND_FROM, or configure the SMTP environment variables.'
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

            sendLoginOtpEmail(admin.email, code).then(() => {
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
  if (
    typeof email !== 'string' ||
    email.trim().toLowerCase() !== SUPER_ADMIN_EMAIL ||
    typeof code !== 'string' ||
    !/^\d{6}$/.test(code)
  ) {
    return res.status(400).json({ error: 'Enter the 6-digit verification code.' });
  }

  db.get(
    `SELECT admins.*, admin_login_otps.code_hash, admin_login_otps.expires_at,
            admin_login_otps.attempts
     FROM admins
     JOIN admin_login_otps ON admin_login_otps.admin_id = admins.id
     WHERE LOWER(admins.email) = ?`,
    [SUPER_ADMIN_EMAIL],
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

  const validCategories = [
    'Academic Issues',
    'Lecturer Behaviour',
    'School Facilities',
    'Hostel Problems',
    'Administrative Issues',
    'General Suggestions'
  ];
  if (
    typeof category !== 'string' ||
    !validCategories.includes(category) ||
    typeof content !== 'string' ||
    !content.trim()
  ) {
    return res.status(400).json({ error: 'Category and content required' });
  }

  const normalizedContent = content.trim();
  if (normalizedContent.length < 20 || normalizedContent.length > 2000) {
    return res.status(400).json({ error: 'Feedback must be between 20 and 2000 characters.' });
  }

  const personalInformation = detectPersonalInformation(normalizedContent);
  if (personalInformation.length > 0) {
    return res.status(400).json({
      error: `For your privacy, remove personal details before submitting. Detected: ${personalInformation.join(', ')}.`
    });
  }

  const referenceCode = generateReferenceCode();

  db.run(
    'INSERT INTO complaints (reference_code, category, content) VALUES (?, ?, ?)',
    [referenceCode, category, normalizedContent],
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