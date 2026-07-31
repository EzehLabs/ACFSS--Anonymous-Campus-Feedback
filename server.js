const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Database initialization
const db = new sqlite3.Database('./complaints.db', (err) => {
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

  // Initialize super admin if not exists
  db.get('SELECT * FROM admins WHERE email = ?', ['ezehfranklin@futo.edu.ng'], (err, row) => {
    if (!row) {
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      db.run(
        'INSERT INTO admins (email, password, name, can_create_admins) VALUES (?, ?, ?, ?)',
        ['ezehfranklin@futo.edu.ng', hashedPassword, 'Ezeh Franklin', 1],
        (err) => {
          if (err) console.error('Error creating super admin:', err);
          else console.log('Super admin created successfully');
        }
      );
    }
  });
});

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

// ============ AUTHENTICATION ROUTES ============

// Admin login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  db.get('SELECT * FROM admins WHERE email = ?', [email], (err, admin) => {
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

    // Generate JWT token
    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        can_create_admins: admin.can_create_admins
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        can_create_admins: admin.can_create_admins === 1
      }
    });
  });
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