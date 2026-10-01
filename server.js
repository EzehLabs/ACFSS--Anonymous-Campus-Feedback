const express = require('express');
const { Pool } = require('pg');
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
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Database configuration is missing. Set DATABASE_URL to your hosted PostgreSQL connection string.');
  process.exit(1);
}
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
const DEFAULT_REVIEW_TERMS = [
  'everyone knows',
  'without evidence',
  'no evidence',
  'fraud',
  'stole',
  'theft',
  'corrupt',
  'harassment',
  'harass',
  'assault',
  'abuse',
  'cheating'
];

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});
pool.on('error', error => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

function parameterize(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function query(sql, params = []) {
  return pool.query(parameterize(sql), params);
}

const db = {
  get(sql, params, callback) {
    query(sql, params)
      .then(result => callback(null, result.rows[0]))
      .catch(callback);
  },
  all(sql, params, callback) {
    query(sql, params)
      .then(result => callback(null, result.rows))
      .catch(callback);
  },
  run(sql, params, callback) {
    query(sql, params)
      .then(() => callback(null))
      .catch(callback);
  }
};

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      can_create_admins INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id SERIAL PRIMARY KEY,
      reference_code TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Unreviewed',
      priority TEXT NOT NULL DEFAULT 'Medium',
      sentiment TEXT NOT NULL DEFAULT 'Neutral',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_preferences (
      admin_id INTEGER PRIMARY KEY,
      theme TEXT NOT NULL DEFAULT 'light',
      accent TEXT NOT NULL DEFAULT 'orange',
      density TEXT NOT NULL DEFAULT 'comfortable',
      avatar_data_url TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_login_otps (
      admin_id INTEGER PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      flag_unverified_claims BOOLEAN NOT NULL DEFAULT TRUE,
      review_terms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(
    `INSERT INTO pipeline_settings (id, flag_unverified_claims, review_terms)
     VALUES (1, TRUE, $1)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_REVIEW_TERMS]
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nlp_filter_logs (
      id BIGSERIAL PRIMARY KEY,
      reference_code TEXT,
      category TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Connected to PostgreSQL database.');
  await initializeSuperAdmin();
}

async function initializeSuperAdmin() {
  if (!SUPER_ADMIN_PASSWORD) {
    console.error('Super admin credentials are not configured. Set SUPER_ADMIN_PASSWORD in the environment.');
    return;
  }

  const legacyEmailParams = LEGACY_SUPER_ADMIN_EMAILS.map(email => email.toLowerCase());
  const legacyPlaceholders = legacyEmailParams.map((_, index) => `$${index + 1}`).join(', ');
  const { rows: legacyAdmins } = await pool.query(
    `SELECT id, email FROM admins WHERE LOWER(email) IN (${legacyPlaceholders}) ORDER BY id`,
    legacyEmailParams
  );
  const { rows: configuredAdmins } = await query(
    'SELECT id FROM admins WHERE LOWER(email) = ?',
    [SUPER_ADMIN_EMAIL]
  );
  const configuredAdmin = configuredAdmins[0];
  const hashedPassword = bcrypt.hashSync(SUPER_ADMIN_PASSWORD, 10);

  if (configuredAdmin) {
    await query(
      'UPDATE admins SET email = ?, password = ?, can_create_admins = 1 WHERE id = ?',
      [SUPER_ADMIN_EMAIL, hashedPassword, configuredAdmin.id]
    );
    const previousAccountIds = legacyAdmins
      .filter(admin => admin.id !== configuredAdmin.id)
      .map(admin => admin.id);
    if (previousAccountIds.length > 0) {
      const placeholders = previousAccountIds.map((_, index) => `$${index + 1}`).join(', ');
      await pool.query(
        `UPDATE admins SET can_create_admins = 0 WHERE id IN (${placeholders})`,
        previousAccountIds
      );
    }
    console.log('Configured super admin credentials updated.');
    return;
  }

  if (legacyAdmins.length > 0) {
    const [accountToMigrate, ...accountsToDemote] = legacyAdmins;
    await query(
      'UPDATE admins SET email = ?, password = ?, can_create_admins = 1 WHERE id = ?',
      [SUPER_ADMIN_EMAIL, hashedPassword, accountToMigrate.id]
    );
    if (accountsToDemote.length > 0) {
      const accountIds = accountsToDemote.map(admin => admin.id);
      const placeholders = accountIds.map((_, index) => `$${index + 1}`).join(', ');
      await pool.query(
        `UPDATE admins SET can_create_admins = 0 WHERE id IN (${placeholders})`,
        accountIds
      );
    }
    console.log('Super admin credentials migrated from a previous account.');
    return;
  }

  await query(
    'INSERT INTO admins (email, password, name, can_create_admins) VALUES (?, ?, ?, ?)',
    [SUPER_ADMIN_EMAIL, hashedPassword, 'Ezeh Franklin', 1]
  );
  console.log('Super admin created successfully.');
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

function detectReviewFlags(content, reviewTerms) {
  return reviewTerms.filter(term => {
    const escapedTerm = term
      .trim()
      .split(/\s+/)
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapedTerm}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(content);
  });
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
        if (err.code === '23505') {
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

app.get('/api/admin/pipeline-settings', verifyToken, (req, res) => {
  db.get(
    'SELECT flag_unverified_claims, review_terms, updated_at FROM pipeline_settings WHERE id = 1',
    [],
    (err, settings) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to load pipeline settings' });
      }
      if (!settings) {
        return res.status(500).json({ error: 'Pipeline settings are not initialized' });
      }

      res.json({
        success: true,
        settings: {
          block_personal_information: true,
          flag_unverified_claims: settings.flag_unverified_claims,
          review_terms: settings.review_terms,
          updated_at: settings.updated_at
        }
      });
    }
  );
});

app.put('/api/admin/pipeline-settings', verifyToken, (req, res) => {
  if (!req.canCreateAdmins) {
    return res.status(403).json({ error: 'Only the super admin can change pipeline settings' });
  }

  const { flag_unverified_claims: flagUnverifiedClaims, review_terms: reviewTerms } = req.body;
  if (
    typeof flagUnverifiedClaims !== 'boolean' ||
    !Array.isArray(reviewTerms) ||
    reviewTerms.length > 50 ||
    reviewTerms.some(term =>
      typeof term !== 'string' ||
      !term.trim() ||
      term.trim().length > 80 ||
      /[\r\n]/.test(term)
    )
  ) {
    return res.status(400).json({ error: 'Provide a boolean flag and up to 50 review phrases of 1–80 characters each' });
  }

  const normalizedTerms = [...new Set(reviewTerms.map(term => term.trim().toLocaleLowerCase()))];
  db.run(
    `UPDATE pipeline_settings
     SET flag_unverified_claims = ?, review_terms = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [flagUnverifiedClaims, normalizedTerms],
    err => {
      if (err) {
        return res.status(500).json({ error: 'Failed to save pipeline settings' });
      }
      res.json({
        success: true,
        message: 'Pipeline settings saved',
        settings: {
          block_personal_information: true,
          flag_unverified_claims: flagUnverifiedClaims,
          review_terms: normalizedTerms
        }
      });
    }
  );
});

app.get('/api/admin/nlp-logs', verifyToken, (req, res) => {
  db.all(
    `SELECT id, reference_code, category, decision, reason_codes, created_at
     FROM nlp_filter_logs ORDER BY created_at DESC, id DESC LIMIT 200`,
    [],
    (err, logs) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to load NLP filter logs' });
      }
      res.json({ success: true, logs });
    }
  );
});

// Submit complaint
app.post('/api/complaints/submit', async (req, res) => {
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
  const settingsResult = await query(
    'SELECT flag_unverified_claims, review_terms FROM pipeline_settings WHERE id = 1'
  ).catch(error => {
    console.error('Failed to load pipeline settings for feedback submission:', error);
    return null;
  });
  if (!settingsResult?.rows[0]) {
    return res.status(503).json({ error: 'Feedback filters are temporarily unavailable. Please try again later.' });
  }

  const pipelineSettings = settingsResult.rows[0];
  const reviewFlags = pipelineSettings.flag_unverified_claims
    ? detectReviewFlags(normalizedContent, pipelineSettings.review_terms)
    : [];
  const referenceCode = generateReferenceCode();
  const client = await pool.connect().catch(error => {
    console.error('Failed to connect to the database for feedback submission:', error);
    return null;
  });
  if (!client) {
    return res.status(503).json({ error: 'Feedback service is temporarily unavailable. Please try again later.' });
  }

  try {
    await client.query('BEGIN');
    if (personalInformation.length > 0) {
      await client.query(
        `INSERT INTO nlp_filter_logs (category, decision, reason_codes)
         VALUES ($1, 'blocked_personal_information', $2)`,
        [category, personalInformation]
      );
      await client.query('COMMIT');
      return res.status(400).json({
        error: `For your privacy, remove personal details before submitting. Detected: ${personalInformation.join(', ')}.`
      });
    }

    await client.query(
      'INSERT INTO complaints (reference_code, category, content) VALUES ($1, $2, $3) RETURNING id',
      [referenceCode, category, normalizedContent]
    );
    await client.query(
      `INSERT INTO nlp_filter_logs (reference_code, category, decision, reason_codes)
       VALUES ($1, $2, $3, $4)`,
      [
        referenceCode,
        category,
        reviewFlags.length > 0 ? 'flagged_for_human_review' : 'accepted',
        reviewFlags.length > 0 ? ['configured_review_phrase'] : []
      ]
    );
    await client.query('COMMIT');

    res.json({
      success: true,
      message: reviewFlags.length > 0
        ? 'Feedback submitted and flagged for staff review.'
        : 'Feedback submitted successfully',
      reference_code: referenceCode,
      flagged_for_review: reviewFlags.length > 0
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackError => {
      console.error('Failed to roll back feedback moderation transaction:', rollbackError);
    });
    console.error('Failed to process feedback submission:', error);
    res.status(500).json({ error: 'Failed to process feedback submission' });
  } finally {
    client.release();
  }
});

// Get all complaints (admin only)
app.get('/api/complaints', verifyToken, (req, res) => {
  db.all(
    `SELECT complaints.*,
            EXISTS (
              SELECT 1 FROM nlp_filter_logs
              WHERE nlp_filter_logs.reference_code = complaints.reference_code
                AND nlp_filter_logs.decision = 'flagged_for_human_review'
            ) AS flagged_for_human_review
     FROM complaints ORDER BY submitted_at DESC`,
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

  if (updateValues.length === 0) {
    return res.status(400).json({ error: 'At least one complaint field must be provided' });
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

// Start the HTTP server only after PostgreSQL schema and admin setup finish.
initializeDatabase()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Set a different PORT or stop the process using this port.`);
      } else {
        console.error('Server error:', err);
      }
      pool.end().finally(() => process.exit(1));
    });

    const shutdown = signal => {
      console.log(`${signal} received; shutting down.`);
      server.close(() => {
        pool.end()
          .then(() => process.exit(0))
          .catch(error => {
            console.error('Error closing PostgreSQL connection pool:', error);
            process.exit(1);
          });
      });
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  })
  .catch(error => {
    console.error('Failed to initialize PostgreSQL database:', error);
    pool.end().finally(() => process.exit(1));
  });