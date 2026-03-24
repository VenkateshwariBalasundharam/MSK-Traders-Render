// ============================================
//  MSK TRADERS - Node.js + PostgreSQL Backend
//  server.js — Render.com deployment version
//  ✅ bcrypt password hashing
//  ✅ PostgreSQL (free on Render)
//  ✅ Dynamic API URL (works on any host)
// ============================================

const express = require("express");
const { Pool } = require("pg");
const cors    = require("cors");
const path    = require("path");
const bcrypt  = require("bcrypt");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ============================================
//  POSTGRESQL CONFIG — uses DATABASE_URL env var
// ============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ============================================
//  AUTO CREATE TABLES
// ============================================
async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        contact    VARCHAR(20)  NOT NULL,
        "createdAt" TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(100) NOT NULL,
        batch_no        VARCHAR(50)  NOT NULL,
        supplier        VARCHAR(100),
        category        VARCHAR(50),
        quantity        INT          DEFAULT 0,
        purchase_price  DECIMAL(10,2) DEFAULT 0,
        selling_price   DECIMAL(10,2) DEFAULT 0,
        purchase_date   DATE,
        expiry_date     DATE,
        status          VARCHAR(20)  DEFAULT 'Received',
        "createdAt"     TIMESTAMP    DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id         SERIAL PRIMARY KEY,
        username   VARCHAR(50)  NOT NULL UNIQUE,
        password   VARCHAR(255) NOT NULL,
        "updatedAt" TIMESTAMP   DEFAULT NOW()
      )
    `);

    // Create default admin if not exists
    const existing = await client.query(
      `SELECT COUNT(*) AS cnt FROM admin WHERE username = 'admin'`
    );
    if (parseInt(existing.rows[0].cnt) === 0) {
      const hashed = await bcrypt.hash("1234", 10);
      await client.query(
        `INSERT INTO admin (username, password) VALUES ($1, $2)`,
        ["admin", hashed]
      );
      console.log("✅ Default admin created with hashed password");
    } else {
      // Auto-upgrade plain text password if needed
      const row = await client.query(
        `SELECT id, password FROM admin WHERE username = 'admin'`
      );
      const pw = (row.rows[0]?.password || "").trim();
      if (!pw.startsWith("$2b$") && !pw.startsWith("$2a$")) {
        const hashed = await bcrypt.hash(pw, 10);
        await client.query(
          `UPDATE admin SET password = $1 WHERE username = 'admin'`,
          [hashed]
        );
        console.log("✅ Plain-text password upgraded to bcrypt hash");
      }
    }

    console.log("✅ Tables ready (products, suppliers, admin)");
  } finally {
    client.release();
  }
}

// ============================================
//  API — STATUS
// ============================================
app.get("/api/status", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "connected", message: "PostgreSQL connected successfully" });
  } catch (err) {
    res.status(500).json({ status: "disconnected", error: err.message });
  }
});

// ============================================
//  API — LOGIN
// ============================================
app.post("/api/login", async (req, res) => {
  const username = (req.body.username || "").trim();
  const password = (req.body.password || "").trim();

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, password FROM admin WHERE LOWER(username) = LOWER($1)`,
      [username]
    );

    console.log("Login attempt — username:", username);

    if (result.rows.length === 0) {
      console.log("Login FAILED — username not found");
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password.trim());

    if (!match) {
      console.log("Login FAILED — wrong password");
      return res.status(401).json({ error: "Invalid username or password" });
    }

    console.log("Login SUCCESS for:", user.username);
    res.json({ success: true, username: user.username });

  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
//  API — CHANGE PASSWORD
// ============================================
app.post("/api/change-password", async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;

  if (!username || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "All fields required" });
  }

  try {
    const result = await pool.query(
      `SELECT id, password FROM admin WHERE LOWER(username) = LOWER($1)`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(currentPassword, user.password.trim());

    if (!match) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const hashedNew = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE admin SET password = $1, "updatedAt" = NOW() WHERE id = $2`,
      [hashedNew, user.id]
    );

    console.log("Password changed for:", username);
    res.json({ success: true, message: "Password changed successfully" });

  } catch (err) {
    console.error("Change PW error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
//  API — PRODUCTS
// ============================================
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, batch_no, supplier, category, quantity,
        purchase_price, selling_price,
        TO_CHAR(purchase_date, 'YYYY-MM-DD') AS purchase_date,
        TO_CHAR(expiry_date,   'YYYY-MM-DD') AS expiry_date,
        status, "createdAt"
      FROM products ORDER BY "createdAt" DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/products error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/products", async (req, res) => {
  const {
    name, batch_no, supplier, category,
    quantity, purchase_price, selling_price,
    purchase_date, expiry_date, status
  } = req.body;

  if (!name || !batch_no || !quantity || !expiry_date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await pool.query(`
      INSERT INTO products
        (name, batch_no, supplier, category, quantity,
         purchase_price, selling_price, purchase_date, expiry_date, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, name, batch_no, supplier, category, quantity,
        purchase_price, selling_price,
        TO_CHAR(purchase_date, 'YYYY-MM-DD') AS purchase_date,
        TO_CHAR(expiry_date,   'YYYY-MM-DD') AS expiry_date,
        status
    `, [
      name, batch_no, supplier || "", category || "",
      parseInt(quantity),
      parseFloat(purchase_price) || 0,
      parseFloat(selling_price)  || 0,
      purchase_date || null, expiry_date,
      status || "Received"
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/products error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/products/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid product ID" });

  const {
    name, batch_no, supplier, category,
    quantity, purchase_price, selling_price,
    purchase_date, expiry_date, status
  } = req.body;

  try {
    const result = await pool.query(`
      UPDATE products SET
        name = $1, batch_no = $2, supplier = $3, category = $4,
        quantity = $5, purchase_price = $6, selling_price = $7,
        purchase_date = $8, expiry_date = $9, status = $10
      WHERE id = $11
    `, [
      name, batch_no, supplier || "", category || "",
      parseInt(quantity),
      parseFloat(purchase_price) || 0,
      parseFloat(selling_price)  || 0,
      purchase_date || null, expiry_date,
      status || "Received", id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json({ success: true, message: "Product updated" });
  } catch (err) {
    console.error("PUT /api/products error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid product ID" });
  try {
    const result = await pool.query(
      "DELETE FROM products WHERE id = $1", [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    console.error("DELETE /api/products error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
//  API — SUPPLIERS
// ============================================
app.get("/api/suppliers", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, contact, "createdAt" FROM suppliers ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/suppliers error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/suppliers", async (req, res) => {
  const { name, contact } = req.body;
  if (!name || !contact) {
    return res.status(400).json({ error: "Missing required fields: name, contact" });
  }
  try {
    const result = await pool.query(`
      INSERT INTO suppliers (name, contact)
      VALUES ($1, $2)
      RETURNING id, name, contact
    `, [name, contact]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/suppliers error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/suppliers/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid supplier ID" });
  try {
    const result = await pool.query(
      "DELETE FROM suppliers WHERE id = $1", [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Supplier not found" });
    }
    res.json({ success: true, message: "Supplier deleted" });
  } catch (err) {
    console.error("DELETE /api/suppliers error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
//  STATIC ROUTES
// ============================================
app.get("/",           (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/login",      (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/login.html", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/index.html", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("*",           (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// ============================================
//  START SERVER
// ============================================
createTables().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("================================================");
    console.log(`🚀  Server running on port ${PORT}`);
    console.log(`🔒  bcrypt hashing : ENABLED`);
    console.log(`🐘  Database       : PostgreSQL`);
    console.log("================================================");
  });
}).catch(err => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
