const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const dbPath = path.join(__dirname, 'kava_data.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    display_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    balance REAL DEFAULT 0.0,
    is_synced INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kava_consumption (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    cups INTEGER NOT NULL,
    total REAL NOT NULL,
    date TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    is_synced INTEGER DEFAULT 1,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    is_synced INTEGER DEFAULT 1,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT DEFAULT '',
    description TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );
`);

// ========== MEMBERS ==========

// POST /api/members — upsert from mobile sync
app.post('/api/members', (req, res) => {
    const { id, display_id, name, phone, balance, created_at } = req.body;
    if (!id || !display_id || !name) {
        return res.status(400).json({ error: 'Missing required fields: id, display_id, name' });
    }

    const stmt = db.prepare(`
    INSERT INTO members (id, display_id, name, phone, balance, is_synced, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_id = excluded.display_id,
      name = excluded.name,
      phone = excluded.phone,
      balance = excluded.balance,
      is_synced = 1
  `);
    stmt.run(id, display_id, name, phone || '', balance || 0, created_at || Date.now());
    res.status(201).json({ success: true });
});

// GET /api/members
app.get('/api/members', (_req, res) => {
    const members = db.prepare('SELECT * FROM members ORDER BY created_at ASC').all();
    res.json(members);
});

// GET /api/members/:id
app.get('/api/members/:id', (req, res) => {
    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json(member);
});

// DELETE /api/members/:id
app.delete('/api/members/:id', (req, res) => {
    db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ========== KAVA CONSUMPTION ==========

// POST /api/consumption — upsert from mobile sync
app.post('/api/consumption', (req, res) => {
    const { id, member_id, cups, total, date, timestamp } = req.body;
    if (!id || !member_id) {
        return res.status(400).json({ error: 'Missing required fields: id, member_id' });
    }

    const stmt = db.prepare(`
    INSERT INTO kava_consumption (id, member_id, cups, total, date, timestamp, is_synced)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      cups = excluded.cups,
      total = excluded.total,
      is_synced = 1
  `);
    stmt.run(id, member_id, cups || 1, total || 0, date || '', timestamp || Date.now());
    res.status(201).json({ success: true });
});

// GET /api/consumption?date=yyyy-MM-dd
app.get('/api/consumption', (req, res) => {
    const { date, member_id } = req.query;
    let rows;
    if (date) {
        rows = db.prepare('SELECT * FROM kava_consumption WHERE date = ? ORDER BY timestamp DESC').all(date);
    } else if (member_id) {
        rows = db.prepare('SELECT * FROM kava_consumption WHERE member_id = ? ORDER BY timestamp DESC').all(member_id);
    } else {
        rows = db.prepare('SELECT * FROM kava_consumption ORDER BY timestamp DESC LIMIT 200').all();
    }
    res.json(rows);
});

// DELETE /api/consumption/:id
app.delete('/api/consumption/:id', (req, res) => {
    db.prepare('DELETE FROM kava_consumption WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ========== PAYMENTS ==========

// POST /api/payments — upsert from mobile sync
app.post('/api/payments', (req, res) => {
    const { id, member_id, amount, date, timestamp } = req.body;
    if (!id || !member_id) {
        return res.status(400).json({ error: 'Missing required fields: id, member_id' });
    }

    const stmt = db.prepare(`
    INSERT INTO payments (id, member_id, amount, date, timestamp, is_synced)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      amount = excluded.amount,
      is_synced = 1
  `);
    stmt.run(id, member_id, amount || 0, date || '', timestamp || Date.now());
    res.status(201).json({ success: true });
});

// GET /api/payments?date=yyyy-MM-dd
app.get('/api/payments', (req, res) => {
    const { date, member_id } = req.query;
    let rows;
    if (date) {
        rows = db.prepare('SELECT * FROM payments WHERE date = ? ORDER BY timestamp DESC').all(date);
    } else if (member_id) {
        rows = db.prepare('SELECT * FROM payments WHERE member_id = ? ORDER BY timestamp DESC').all(member_id);
    } else {
        rows = db.prepare('SELECT * FROM payments ORDER BY timestamp DESC LIMIT 200').all();
    }
    res.json(rows);
});

// DELETE /api/payments/:id
app.delete('/api/payments/:id', (req, res) => {
    db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ========== EXPENSES (mobile sync: payment collected + member debt) ==========

// POST /api/expenses — matches production API used by Flutter sync
app.post('/api/expenses', (req, res) => {
    const { date, category, description, amount, notes } = req.body;
    const id = crypto.randomUUID();
    const stmt = db.prepare(`
    INSERT INTO expenses (id, date, category, description, amount, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(
        id,
        date || '',
        category || '',
        description || '',
        Number(amount) || 0,
        notes || '',
        Date.now()
    );
    res.status(201).json({ success: true, id });
});

// GET /api/expenses?date=yyyy-MM-dd
app.get('/api/expenses', (req, res) => {
    const { date } = req.query;
    let rows;
    if (date) {
        rows = db.prepare('SELECT * FROM expenses WHERE date = ? ORDER BY created_at DESC').all(date);
    } else {
        rows = db.prepare('SELECT * FROM expenses ORDER BY created_at DESC LIMIT 200').all();
    }
    res.json(rows);
});

// ========== REPORTS ==========

// GET /api/reports/daily?date=yyyy-MM-dd
app.get('/api/reports/daily', (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const cups = db.prepare(
        'SELECT COALESCE(SUM(cups), 0) as cups, COALESCE(SUM(total), 0) as revenue FROM kava_consumption WHERE date = ?'
    ).get(date);

    const payments = db.prepare(
        'SELECT COALESCE(SUM(amount), 0) as collected FROM payments WHERE date = ?'
    ).get(date);

    const members = db.prepare(
        'SELECT COUNT(DISTINCT member_id) as count FROM kava_consumption WHERE date = ?'
    ).get(date);

    res.json({
        date,
        cups: cups.cups,
        revenue: cups.revenue,
        collected: payments.collected,
        members: members.count,
        outstanding: cups.revenue - payments.collected,
    });
});

// GET /api/reports/member/:id
app.get('/api/reports/member/:id', (req, res) => {
    const memberId = req.params.id;
    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const spent = db.prepare(
        'SELECT COALESCE(SUM(total), 0) as total FROM kava_consumption WHERE member_id = ?'
    ).get(memberId);

    const paid = db.prepare(
        'SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE member_id = ?'
    ).get(memberId);

    const totalCups = db.prepare(
        'SELECT COALESCE(SUM(cups), 0) as total FROM kava_consumption WHERE member_id = ?'
    ).get(memberId);

    res.json({
        member,
        totalCups: totalCups.total,
        totalSpent: spent.total,
        totalPaid: paid.total,
        balance: spent.total - paid.total,
    });
});

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// ========== WEBSITE & DOWNLOADS ==========
// Static files are served from the public directory (index.html, CSS, etc.)
// For APK downloads: place your built APK file at: server/public/downloads/kava_app.apk
// The landing page will be automatically served at the root URL

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🥥 Kava Server running on http://0.0.0.0:${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api`);
});
