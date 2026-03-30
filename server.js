// ============================================
//  MSK TRADERS - Node.js + PostgreSQL Backend
//  server.js — Updated with Billing, Sales & User Management
//  ✅ bcrypt password hashing
//  ✅ PostgreSQL (free on Render)
//  ✅ Billing / Sales module
//  ✅ Multi-user (owner adds/removes staff)
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
//  POSTGRESQL CONFIG
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
        role       VARCHAR(20)  DEFAULT 'staff',
        "updatedAt" TIMESTAMP   DEFAULT NOW()
      )
    `);

    // ✅ FIX: Auto-migrate — add role column if it was missing from old DB
    await client.query(`
      ALTER TABLE admin ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'staff'
    `);

    // New: sales table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id           SERIAL PRIMARY KEY,
        bill_no      VARCHAR(30)  NOT NULL UNIQUE,
        customer     VARCHAR(100) DEFAULT 'Walk-in Customer',
        total_amount DECIMAL(10,2) DEFAULT 0,
        discount     DECIMAL(10,2) DEFAULT 0,
        final_amount DECIMAL(10,2) DEFAULT 0,
        sold_by      VARCHAR(50),
        "createdAt"  TIMESTAMP DEFAULT NOW()
      )
    `);

    // New: sale items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id           SERIAL PRIMARY KEY,
        sale_id      INT REFERENCES sales(id) ON DELETE CASCADE,
        product_id   INT,
        product_name VARCHAR(100),
        batch_no     VARCHAR(50),
        quantity     INT DEFAULT 1,
        unit_price   DECIMAL(10,2) DEFAULT 0,
        discount_pct DECIMAL(5,2)  DEFAULT 0,
        line_total   DECIMAL(10,2) DEFAULT 0
      )
    `);

    // Create default admin if not exists
    const existing = await client.query(
      `SELECT COUNT(*) AS cnt FROM admin WHERE username = 'admin'`
    );
    if (parseInt(existing.rows[0].cnt) === 0) {
      const hashed = await bcrypt.hash("1234", 10);
      await client.query(
        `INSERT INTO admin (username, password, role) VALUES ($1, $2, 'owner')`,
        ["admin", hashed]
      );
      console.log("✅ Default owner created with hashed password");
    } else {
      // Auto-upgrade plain text + ensure role column has owner for admin
      const row = await client.query(
        `SELECT id, password, role FROM admin WHERE username = 'admin'`
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
      // Ensure admin is owner
      if (row.rows[0]?.role !== 'owner') {
        await client.query(`UPDATE admin SET role = 'owner' WHERE username = 'admin'`);
        console.log("✅ Admin role updated to owner");
      }
    }

    console.log("✅ Tables ready (products, suppliers, admin, sales, sale_items)");
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
      `SELECT id, username, password, role FROM admin WHERE LOWER(username) = LOWER($1)`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user  = result.rows[0];
    const match = await bcrypt.compare(password, user.password.trim());

    if (!match) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    console.log("Login SUCCESS for:", user.username, "role:", user.role);
    res.json({ success: true, username: user.username, role: user.role });

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
  if (!username || !currentPassword || !newPassword)
    return res.status(400).json({ error: "All fields required" });

  try {
    const result = await pool.query(
      `SELECT id, password FROM admin WHERE LOWER(username) = LOWER($1)`, [username]
    );
    if (!result.rows.length)
      return res.status(401).json({ error: "Current password is incorrect" });

    const user  = result.rows[0];
    const match = await bcrypt.compare(currentPassword, user.password.trim());
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });

    const hashedNew = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE admin SET password = $1, "updatedAt" = NOW() WHERE id = $2`,
      [hashedNew, user.id]
    );
    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
//  API — USER MANAGEMENT (owner only)
// ============================================
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, "updatedAt" FROM admin ORDER BY id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/users", async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required" });

  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO admin (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role`,
      [username.trim(), hashed, role || "staff"]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(400).json({ error: "Username already exists" });
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    // Prevent deleting the last owner
    const ownerCheck = await pool.query(
      `SELECT COUNT(*) AS cnt FROM admin WHERE role = 'owner'`
    );
    const userRow = await pool.query(`SELECT role FROM admin WHERE id = $1`, [id]);
    if (!userRow.rows.length)
      return res.status(404).json({ error: "User not found" });
    if (userRow.rows[0].role === 'owner' && parseInt(ownerCheck.rows[0].cnt) <= 1)
      return res.status(400).json({ error: "Cannot delete the last owner account" });

    await pool.query("DELETE FROM admin WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
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
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/products", async (req, res) => {
  const { name, batch_no, supplier, category, quantity,
          purchase_price, selling_price, purchase_date, expiry_date, status } = req.body;
  if (!name || !batch_no || !quantity || !expiry_date)
    return res.status(400).json({ error: "Missing required fields" });

  try {
    const result = await pool.query(`
      INSERT INTO products
        (name, batch_no, supplier, category, quantity,
         purchase_price, selling_price, purchase_date, expiry_date, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, name, batch_no, supplier, category, quantity,
        purchase_price, selling_price,
        TO_CHAR(purchase_date, 'YYYY-MM-DD') AS purchase_date,
        TO_CHAR(expiry_date,   'YYYY-MM-DD') AS expiry_date, status
    `, [name, batch_no, supplier||"", category||"",
        parseInt(quantity), parseFloat(purchase_price)||0,
        parseFloat(selling_price)||0, purchase_date||null, expiry_date, status||"Received"]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/products/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, batch_no, supplier, category, quantity,
          purchase_price, selling_price, purchase_date, expiry_date, status } = req.body;
  try {
    const result = await pool.query(`
      UPDATE products SET
        name=$1, batch_no=$2, supplier=$3, category=$4,
        quantity=$5, purchase_price=$6, selling_price=$7,
        purchase_date=$8, expiry_date=$9, status=$10
      WHERE id=$11
    `, [name, batch_no, supplier||"", category||"",
        parseInt(quantity), parseFloat(purchase_price)||0,
        parseFloat(selling_price)||0, purchase_date||null, expiry_date, status||"Received", id]);
    if (!result.rowCount) return res.status(404).json({ error: "Product not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const result = await pool.query("DELETE FROM products WHERE id=$1", [id]);
    if (!result.rowCount) return res.status(404).json({ error: "Product not found" });
    res.json({ success: true });
  } catch (err) {
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
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/suppliers", async (req, res) => {
  const { name, contact } = req.body;
  if (!name || !contact)
    return res.status(400).json({ error: "Missing required fields: name, contact" });
  try {
    const result = await pool.query(
      `INSERT INTO suppliers (name, contact) VALUES ($1,$2) RETURNING id, name, contact`,
      [name, contact]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/suppliers/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const result = await pool.query("DELETE FROM suppliers WHERE id=$1", [id]);
    if (!result.rowCount) return res.status(404).json({ error: "Supplier not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
//  API — SALES (Create Bill)
// ============================================
app.get("/api/sales", async (req, res) => {
  try {
    const { from, to } = req.query;
    let q = `SELECT * FROM sales ORDER BY "createdAt" DESC LIMIT 200`;
    const params = [];
    if (from && to) {
      q = `SELECT * FROM sales WHERE DATE("createdAt") BETWEEN $1 AND $2 ORDER BY "createdAt" DESC`;
      params.push(from, to);
    }
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sales/:id/items", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM sale_items WHERE sale_id = $1`, [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sales", async (req, res) => {
  const { customer, items, discount, sold_by } = req.body;
  if (!items || !items.length)
    return res.status(400).json({ error: "No items in bill" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Generate bill number: MSK-YYYYMMDD-XXXX
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const cntRes  = await client.query(`SELECT COUNT(*) AS cnt FROM sales`);
    const seq     = String(parseInt(cntRes.rows[0].cnt) + 1).padStart(4,"0");
    const bill_no = `MSK-${dateStr}-${seq}`;

    // Compute totals
    let totalAmount = 0;
    for (const item of items) {
      const lineTotal = item.quantity * item.unit_price * (1 - (item.discount_pct||0)/100);
      totalAmount += lineTotal;
      item._lineTotal = parseFloat(lineTotal.toFixed(2));
    }
    const discountAmt  = parseFloat(discount) || 0;
    const finalAmount  = parseFloat((totalAmount - discountAmt).toFixed(2));

    // Insert sale
    const saleRes = await client.query(`
      INSERT INTO sales (bill_no, customer, total_amount, discount, final_amount, sold_by)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [bill_no, customer||"Walk-in Customer",
        parseFloat(totalAmount.toFixed(2)), discountAmt, finalAmount, sold_by||"admin"]);

    const saleId = saleRes.rows[0].id;

    // Insert items & deduct stock
    for (const item of items) {
      await client.query(`
        INSERT INTO sale_items
          (sale_id, product_id, product_name, batch_no, quantity, unit_price, discount_pct, line_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [saleId, item.product_id, item.product_name, item.batch_no,
          item.quantity, item.unit_price, item.discount_pct||0, item._lineTotal]);

      // Deduct stock
      await client.query(
        `UPDATE products SET quantity = GREATEST(quantity - $1, 0) WHERE id = $2`,
        [item.quantity, item.product_id]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true, sale: saleRes.rows[0], items });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/sales error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete("/api/sales/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await pool.query("DELETE FROM sales WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
//  API — SALES SUMMARY (for dashboard)
// ============================================
app.get("/api/sales/summary", async (req, res) => {
  try {
    const todayRes = await pool.query(`
      SELECT COALESCE(SUM(final_amount),0) AS today_sales, COUNT(*) AS today_bills
      FROM sales WHERE DATE("createdAt") = CURRENT_DATE
    `);
    const monthRes = await pool.query(`
      SELECT COALESCE(SUM(final_amount),0) AS month_sales, COUNT(*) AS month_bills
      FROM sales
      WHERE DATE_TRUNC('month',"createdAt") = DATE_TRUNC('month', CURRENT_DATE)
    `);
    const totalRes = await pool.query(`
      SELECT COALESCE(SUM(final_amount),0) AS total_sales FROM sales
    `);
    res.json({
      today:  todayRes.rows[0],
      month:  monthRes.rows[0],
      total:  totalRes.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Monthly trend (last 6 months)
app.get("/api/sales/monthly", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT TO_CHAR(DATE_TRUNC('month',"createdAt"), 'Mon YYYY') AS month,
             SUM(final_amount) AS total,
             COUNT(*) AS bills
      FROM sales
      WHERE "createdAt" >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month',"createdAt")
      ORDER BY DATE_TRUNC('month',"createdAt") ASC
    `);
    res.json(result.rows);
  } catch (err) {
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
    console.log(`🔒  bcrypt hashing  : ENABLED`);
    console.log(`🐘  Database        : PostgreSQL`);
    console.log(`🧾  Billing module  : ENABLED`);
    console.log(`👥  Multi-user      : ENABLED`);
    console.log("================================================");
  });
}).catch(err => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});