/* ============================================
   MSK TRADERS - script.js
   Connects to Node.js + SQL Server via REST API
============================================ */

const API = window.location.origin + "/api";

// ============================================
//  STATE
// ============================================
let products         = [];
let suppliers        = [];
let editingProductId = null;
let stockChartInst, stockChart2Inst, categoryChartInst;

// ============================================
//  API HELPER
// ============================================
async function apiCall(method, endpoint, body = null) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" }
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(API + endpoint, options);
  if (!res.ok) {
    let errMsg = "Request failed";
    try { const e = await res.json(); errMsg = e.error || errMsg; } catch {}
    throw new Error(errMsg);
  }
  return res.json();
}

// ============================================
//  DB STATUS CHECK
// ============================================
async function checkDBStatus() {
  const dot      = document.getElementById("dbDot");
  const text     = document.getElementById("dbStatusText");
  const statusEl = document.getElementById("dbStatus");
  if (!dot || !text || !statusEl) return;

  try {
    const res = await fetch(API + "/status");
    if (res.ok) {
      dot.style.color  = "#2ecc71";
      text.textContent = "SQL Server Connected";
      statusEl.classList.add("connected");
      statusEl.classList.remove("error");
    } else {
      throw new Error("not ok");
    }
  } catch {
    dot.style.color  = "#e74c3c";
    text.textContent = "DB Disconnected";
    statusEl.classList.add("error");
    statusEl.classList.remove("connected");
  }
}

// ============================================
//  TOAST NOTIFICATION
// ============================================
function showToast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.innerHTML = `
    <i class="fa-solid ${type === "success" ? "fa-check-circle" : "fa-circle-exclamation"}"></i>
    ${message}
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================
//  NAVIGATION
// ============================================
function showSection(name) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  const sec = document.getElementById("sec-" + name);
  if (sec) sec.classList.add("active");

  document.querySelectorAll(".nav-item").forEach(n => {
    if (n.getAttribute("onclick") && n.getAttribute("onclick").includes("'" + name + "'"))
      n.classList.add("active");
  });

  if (name === "dashboard") renderDashboard();
  if (name === "products")  { renderTable(); populateSupplierDropdown(); }
  if (name === "suppliers") renderSupplierTable();
  if (name === "stock")     renderStockSection();

  closeSidebar();
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("overlay").classList.toggle("visible");
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("visible");
}

function logout() {
  localStorage.removeItem("loggedIn");
  localStorage.removeItem("adminUser");
  window.location.replace("login.html");
}

// ============================================
//  LOAD PRODUCTS FROM SQL SERVER
// ============================================
async function loadProducts() {
  try {
    const data = await apiCall("GET", "/products");

    console.log("RAW DATA FROM DB:", data); // Debug — check F12 Console

    // Safely map all possible column name formats from SQL Server
    products = data.map(p => ({
      id:            p.id,
      name:          p.name           || p.Name           || "",
      batch:         p.batch_no       || p.batchNo        || p.batch   || "",
      supplier:      p.supplier       || p.Supplier       || "",
      category:      p.category       || p.Category       || "",
      quantity:      parseInt(p.quantity || p.Quantity || 0),
      purchasePrice: parseFloat(p.purchase_price || p.purchasePrice || 0),
      sellingPrice:  parseFloat(p.selling_price  || p.sellingPrice  || 0),
      purchaseDate:  formatDate(p.purchase_date  || p.purchaseDate  || ""),
      expiry:        formatDate(p.expiry_date || p.expiryDate || p.expiry || ""),
      status:        p.status         || p.Status         || "Received"
    }));

    renderTable();
    updateDashboardCards();
    showExpiryAlerts();
    showLowStockSuggestions();

  } catch (err) {
    console.error("loadProducts error:", err);
    showToast("Failed to load products: " + err.message, "error");

    // Show error in table
    const tbody = document.querySelector("#productTable tbody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="12" class="table-loading" style="color:var(--red)">
        ⚠ Could not load from database. Check server.js is running.
      </td></tr>`;
    }
  }
}

// Helper: format any date value to YYYY-MM-DD
function formatDate(val) {
  if (!val) return "";
  // Already YYYY-MM-DD
  if (typeof val === "string" && val.length === 10 && val.includes("-")) return val;
  // ISO string like 2025-12-31T00:00:00.000Z
  if (typeof val === "string" && val.includes("T")) return val.split("T")[0];
  // Date object
  if (val instanceof Date) return val.toISOString().split("T")[0];
  return String(val).split("T")[0];
}

// ============================================
//  ADD / UPDATE PRODUCT
// ============================================
async function addProduct() {
  const name          = document.getElementById("productName").value.trim();
  const batch         = document.getElementById("batchNo").value.trim();
  const supplier      = document.getElementById("supplier").value;
  const category      = document.getElementById("category").value;
  const quantity      = parseInt(document.getElementById("quantity").value);
  const expiry        = document.getElementById("expiryDate").value;
  const status        = document.getElementById("status").value;
  const purchasePrice = parseFloat(document.getElementById("purchasePrice").value) || 0;
  const sellingPrice  = parseFloat(document.getElementById("sellingPrice").value)  || 0;

  if (!name || !batch || !supplier || isNaN(quantity) || !expiry) {
    showToast("Please fill all required fields (*)", "error");
    return;
  }

  const payload = {
    name,
    batch_no:       batch,
    supplier,
    category,
    quantity,
    purchase_price: purchasePrice,
    selling_price:  sellingPrice,
    purchase_date:  document.getElementById("purchaseDate").value || null,
    expiry_date:    expiry,
    status
  };

  const btn = document.getElementById("addBtn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  try {
    if (editingProductId) {
      await apiCall("PUT", "/products/" + editingProductId, payload);
      showToast("Product updated successfully!");
      editingProductId = null;
      document.getElementById("cancelEdit").style.display = "none";
    } else {
      await apiCall("POST", "/products", payload);
      showToast("Product saved to database!");
    }

    clearProductForm();
    btn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Product';
    await loadProducts();

  } catch (err) {
    console.error("addProduct error:", err);
    showToast("Error saving product: " + err.message, "error");
    btn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Product';
  } finally {
    btn.disabled = false;
  }
}

// ============================================
//  DELETE PRODUCT
// ============================================
async function deleteProduct(id) {
  if (!confirm("Delete this product from the database?")) return;
  try {
    await apiCall("DELETE", "/products/" + id);
    showToast("Product deleted.");
    await loadProducts();
  } catch (err) {
    showToast("Delete failed: " + err.message, "error");
  }
}

// ============================================
//  EDIT PRODUCT — fill form
// ============================================
function editProduct(id) {
  const p = products.find(p => p.id === id);
  if (!p) return;

  document.getElementById("productName").value   = p.name;
  document.getElementById("batchNo").value       = p.batch;
  document.getElementById("category").value      = p.category || "";
  document.getElementById("quantity").value      = p.quantity;
  document.getElementById("purchaseDate").value  = p.purchaseDate || "";
  document.getElementById("expiryDate").value    = p.expiry;
  document.getElementById("status").value        = p.status;
  document.getElementById("purchasePrice").value = p.purchasePrice;
  document.getElementById("sellingPrice").value  = p.sellingPrice;

  populateSupplierDropdown();
  document.getElementById("supplier").value = p.supplier;

  editingProductId = id;
  document.getElementById("addBtn").innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update Product';
  document.getElementById("cancelEdit").style.display = "inline-flex";

  showSection("products");
  document.querySelector("#sec-products .card").scrollIntoView({ behavior: "smooth" });
}

// ============================================
//  CANCEL EDIT
// ============================================
function cancelEdit() {
  editingProductId = null;
  clearProductForm();
  document.getElementById("addBtn").innerHTML = '<i class="fa-solid fa-plus"></i> Add Product';
  document.getElementById("cancelEdit").style.display = "none";
}

// ============================================
//  CLEAR PRODUCT FORM
// ============================================
function clearProductForm() {
  ["productName","batchNo","purchasePrice","sellingPrice","quantity","purchaseDate","expiryDate"]
    .forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("supplier").value = "";
  document.getElementById("category").value = "";
  document.getElementById("status").value   = "Received";
}

// ============================================
//  FILTER / SEARCH PRODUCTS
// ============================================
function filterProducts() {
  const q = document.getElementById("searchInput").value.toLowerCase();
  document.querySelectorAll("#productTable tbody tr").forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

// ============================================
//  RENDER PRODUCTS TABLE
// ============================================
function renderTable() {
  const tbody = document.querySelector("#productTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!products.length) {
    tbody.innerHTML = `<tr>
      <td colspan="13" class="table-loading">No products found in database.</td>
    </tr>`;
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  products.forEach((p, i) => {
    const expDate   = p.expiry ? new Date(p.expiry) : null;
    const diffDays  = expDate ? (expDate - today) / (1000 * 60 * 60 * 24) : null;
    const expiryClass = diffDays === null ? "" :
                        diffDays < 0  ? "expired"  :
                        diffDays <= 30 ? "expiring" : "";

    const profit    = (p.sellingPrice - p.purchasePrice).toFixed(2);
    const statusTag = p.status === "Pending"
      ? `<span class="tag-pending">Pending</span>`
      : `<span class="tag-received">Received</span>`;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td><strong>${p.name}</strong></td>
      <td>${p.batch}</td>
      <td>${p.supplier}</td>
      <td>${p.category || "—"}</td>
      <td>${p.quantity}</td>
      <td>₹${p.purchasePrice.toFixed(2)}</td>
      <td>₹${p.sellingPrice.toFixed(2)}</td>
      <td>₹${profit}</td>
      <td>${p.purchaseDate || "—"}</td>
      <td class="${expiryClass}">${p.expiry || "—"}</td>
      <td>${statusTag}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm btn-edit" onclick="editProduct(${p.id})">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-sm btn-del" onclick="deleteProduct(${p.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ============================================
//  LOAD SUPPLIERS FROM SQL SERVER
// ============================================
async function loadSuppliers() {
  try {
    const data = await apiCall("GET", "/suppliers");

    console.log("RAW SUPPLIERS FROM DB:", data); // Debug

    suppliers = data.map(s => ({
      id:      s.id,
      name:    s.name    || s.Name    || "",
      contact: s.contact || s.Contact || ""
    }));

    renderSupplierTable();
    populateSupplierDropdown();

  } catch (err) {
    console.error("loadSuppliers error:", err);
    showToast("Failed to load suppliers: " + err.message, "error");
  }
}

// ============================================
//  ADD SUPPLIER
// ============================================
async function addSupplier() {
  const name    = document.getElementById("supplierName").value.trim();
  const contact = document.getElementById("supplierContact").value.trim();

  if (!name || !contact) {
    showToast("Please fill all supplier fields.", "error");
    return;
  }

  try {
    await apiCall("POST", "/suppliers", { name, contact });
    document.getElementById("supplierName").value    = "";
    document.getElementById("supplierContact").value = "";
    showToast("Supplier saved to database!");
    await loadSuppliers();
  } catch (err) {
    showToast("Error saving supplier: " + err.message, "error");
  }
}

// ============================================
//  DELETE SUPPLIER
// ============================================
async function deleteSupplier(id) {
  if (!confirm("Remove this supplier from the database?")) return;
  try {
    await apiCall("DELETE", "/suppliers/" + id);
    showToast("Supplier removed.");
    await loadSuppliers();
  } catch (err) {
    showToast("Delete failed: " + err.message, "error");
  }
}

// ============================================
//  FILTER SUPPLIERS
// ============================================
function filterSuppliers() {
  const q = document.getElementById("supplierSearch").value.toLowerCase();
  document.querySelectorAll("#supplierTable tbody tr").forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

// ============================================
//  RENDER SUPPLIERS TABLE
// ============================================
function renderSupplierTable() {
  const tbody = document.querySelector("#supplierTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!suppliers.length) {
    tbody.innerHTML = `<tr>
      <td colspan="4" class="table-loading">No suppliers found in database.</td>
    </tr>`;
    return;
  }

  suppliers.forEach((s, i) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td><strong>${s.name}</strong></td>
      <td>${s.contact}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm btn-del" onclick="deleteSupplier(${s.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ============================================
//  POPULATE SUPPLIER DROPDOWN IN PRODUCT FORM
// ============================================
function populateSupplierDropdown() {
  const select = document.getElementById("supplier");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Select Supplier *</option>';
  suppliers.forEach(s => {
    const opt       = document.createElement("option");
    opt.value       = s.name;
    opt.textContent = s.name;
    select.appendChild(opt);
  });
  if (current) select.value = current;
}

// ============================================
//  DASHBOARD STATS
// ============================================
function getStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let low = 0, expiring = 0, expired = 0;

  products.forEach(p => {
    if (p.quantity < 50) low++;
    if (p.expiry) {
      const diff = (new Date(p.expiry) - today) / (1000 * 60 * 60 * 24);
      if (diff < 0)        expired++;
      else if (diff <= 30) expiring++;
    }
  });

  return { total: products.length, low, expiring, expired };
}

function updateDashboardCards() {
  const s = getStats();
  const map = {
    totalProducts: s.total,
    lowStock:      s.low,
    expiringSoon:  s.expiring,
    expiredCount:  s.expired
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

function showExpiryAlerts() {
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  const alerts = [];

  products.forEach(p => {
    if (!p.expiry) return;
    const diff = (new Date(p.expiry) - today) / (1000 * 60 * 60 * 24);
    if (diff < 0)        alerts.push(`${p.name} (Expired)`);
    else if (diff <= 30) alerts.push(`${p.name} (~${Math.round(diff)} days left)`);
  });

  const el = document.getElementById("expiryAlert");
  if (!el) return;
  if (alerts.length) {
    el.style.display = "block";
    el.innerHTML = `⚠ Expiry Alerts: ${alerts.join(" • ")}`;
  } else {
    el.style.display = "none";
  }
}

function showLowStockSuggestions() {
  const box = document.getElementById("lowStockSuggestions");
  if (!box) return;

  const low = products.filter(p => p.quantity < 50);

  if (!low.length) {
    box.innerHTML = `<div class="reorder-empty">
      <i class="fa-solid fa-check-circle"></i> All medicines have sufficient stock.
    </div>`;
    return;
  }

  box.innerHTML = low.map(p => `
    <div class="reorder-item">
      <span class="name">${p.name}</span>
      <span class="qty">Qty: ${p.quantity}</span>
    </div>
  `).join("");
}

function renderDashboard() {
  updateDashboardCards();
  showExpiryAlerts();
  showLowStockSuggestions();
  renderStockChart("stockChart");
}

// ============================================
//  CHARTS
// ============================================
function renderStockChart(canvasId) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (canvasId === "stockChart"  && stockChartInst)  stockChartInst.destroy();
  if (canvasId === "stockChart2" && stockChart2Inst) stockChart2Inst.destroy();

  const s = getStats();

  const inst = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Total", "Low Stock", "Expiring Soon", "Expired"],
      datasets: [{
        label: "Stock Overview",
        data: [s.total, s.low, s.expiring, s.expired],
        backgroundColor: ["#1362a8", "#f1c40f", "#e67e22", "#e74c3c"],
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: "#f0f0f0" } },
        x: { grid: { display: false } }
      }
    }
  });

  if (canvasId === "stockChart")  stockChartInst  = inst;
  if (canvasId === "stockChart2") stockChart2Inst = inst;
}

function renderCategoryChart() {
  const ctx = document.getElementById("categoryChart");
  if (!ctx) return;
  if (categoryChartInst) categoryChartInst.destroy();

  const cats = {};
  products.forEach(p => {
    const c = p.category || "Other";
    cats[c] = (cats[c] || 0) + 1;
  });

  if (!Object.keys(cats).length) return;

  categoryChartInst = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(cats),
      datasets: [{
        data: Object.values(cats),
        backgroundColor: ["#1362a8","#f5a623","#27ae60","#e74c3c","#9b59b6","#16a085"],
        borderWidth: 2,
        borderColor: "#fff"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 12 } } }
      }
    }
  });
}

function renderStockSection() {
  updateDashboardCards();
  renderStockChart("stockChart2");
  renderCategoryChart();

  const container = document.getElementById("lowStockTable");
  if (!container) return;

  const low = products.filter(p => p.quantity < 50);

  if (!low.length) {
    container.innerHTML = `<p style="padding:16px;color:var(--green);font-weight:600">
      ✅ All stock levels are healthy.
    </p>`;
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Product</th>
          <th>Supplier</th>
          <th>Qty</th>
          <th>Expiry</th>
        </tr>
      </thead>
      <tbody>
        ${low.map((p, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${p.name}</strong></td>
            <td>${p.supplier}</td>
            <td style="color:var(--red);font-weight:700">${p.quantity}</td>
            <td>${p.expiry || "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ============================================
//  EXPORT TO CSV
// ============================================
function exportToExcel() {
  if (!products.length) { showToast("No products to export.", "error"); return; }

  const headers = ["#","Product","Batch","Supplier","Category","Qty",
                   "Purchase Price","Selling Price","Profit","Expiry","Status"];

  const rows = products.map((p, i) => [
    i + 1, p.name, p.batch, p.supplier, p.category || "",
    p.quantity, p.purchasePrice.toFixed(2), p.sellingPrice.toFixed(2),
    (p.sellingPrice - p.purchasePrice).toFixed(2),
    p.expiry, p.status
  ]);

  const csv  = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = "MSK_Traders_Inventory.csv";
  a.click();
  URL.revokeObjectURL(url);
  showToast("Exported successfully!");
}

// ============================================
//  GENERATE INVOICE
// ============================================
function generateInvoice() {
  if (!products.length) { showToast("No products for invoice.", "error"); return; }

  const rows = products.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${p.name}</td>
      <td>${p.batch}</td>
      <td>${p.quantity}</td>
      <td>&#8377;${p.purchasePrice.toFixed(2)}</td>
      <td>&#8377;${p.sellingPrice.toFixed(2)}</td>
      <td>&#8377;${(p.sellingPrice - p.purchasePrice).toFixed(2)}</td>
      <td>${p.expiry}</td>
    </tr>
  `).join("");

  const totalProfit = products.reduce((sum, p) =>
    sum + (p.sellingPrice - p.purchasePrice) * p.quantity, 0);

  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html><head>
    <title>MSK Traders Invoice</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 30px; color: #1a2b45; }
      h1   { font-size: 28px; letter-spacing: 3px; color: #0b2545; }
      .sub { color: #6b7a99; font-size: 13px; margin-bottom: 20px; }
      table{ width: 100%; border-collapse: collapse; margin-top: 20px; }
      th   { background: #0b2545; color: white; padding: 10px; text-align: left; font-size: 12px; }
      td   { padding: 9px 10px; border-bottom: 1px solid #dde3f0; font-size: 13px; }
      tr:hover { background: #f7f9ff; }
      .total { margin-top: 20px; font-size: 16px; font-weight: 700; color: #27ae60; }
      @media print { button { display: none; } }
    </style>
    </head><body>
    <h1>MSK TRADERS</h1>
    <p class="sub">Generated: ${new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}</p>
    <button onclick="window.print()"
      style="padding:8px 18px;background:#0b2545;color:white;border:none;border-radius:6px;cursor:pointer">
      Print
    </button>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Product</th><th>Batch</th><th>Qty</th>
          <th>Purchase</th><th>Selling</th><th>Profit</th><th>Expiry</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="total">Total Estimated Profit: &#8377;${totalProfit.toFixed(2)}</p>
    </body></html>`);
  win.document.close();
}

// ============================================
//  CHANGE PASSWORD
// ============================================

function togglePw(fieldId, btn) {
  const input = document.getElementById(fieldId);
  const icon  = btn.querySelector("i");
  if (input.type === "password") {
    input.type    = "text";
    icon.className = "fa-solid fa-eye-slash";
  } else {
    input.type    = "password";
    icon.className = "fa-solid fa-eye";
  }
}

function showPwMsg(message, type = "error") {
  const box = document.getElementById("pwMsg");
  if (!box) return;
  box.style.display      = "block";
  box.style.background   = type === "error" ? "rgba(231,76,60,0.1)"  : "rgba(39,174,96,0.1)";
  box.style.border       = type === "error" ? "1px solid rgba(231,76,60,0.4)" : "1px solid rgba(39,174,96,0.4)";
  box.style.color        = type === "error" ? "#e74c3c" : "#27ae60";
  box.innerHTML = `<i class="fa-solid ${type === "error" ? "fa-circle-exclamation" : "fa-check-circle"}"></i> ${message}`;

  if (type === "success") {
    setTimeout(() => { box.style.display = "none"; }, 4000);
  }
}

async function changePassword() {
  const currentPassword = document.getElementById("currentPassword").value;
  const newPassword     = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const username        = localStorage.getItem("adminUser") || "admin";
  const btn             = document.getElementById("changePwBtn");

  // Validations
  if (!currentPassword || !newPassword || !confirmPassword) {
    showPwMsg("Please fill all fields.");
    return;
  }

  if (newPassword.length < 4) {
    showPwMsg("New password must be at least 4 characters.");
    return;
  }

  if (newPassword !== confirmPassword) {
    showPwMsg("New password and confirm password do not match.");
    return;
  }

  if (currentPassword === newPassword) {
    showPwMsg("New password must be different from current password.");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  try {
    const data = await apiCall("POST", "/change-password", {
      username,
      currentPassword,
      newPassword
    });

    if (data.success) {
      showPwMsg("✅ Password changed successfully! Use new password on next login.", "success");
      // Clear all fields
      document.getElementById("currentPassword").value = "";
      document.getElementById("newPassword").value     = "";
      document.getElementById("confirmPassword").value = "";
    }
  } catch (err) {
    showPwMsg(err.message || "Failed to change password.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save New Password';
  }
}

// ============================================
//  INIT — runs when page loads
// ============================================
document.addEventListener("DOMContentLoaded", async () => {
  const overlay = document.getElementById("loadingOverlay");

  try {
    await checkDBStatus();
    await loadSuppliers();   // Load suppliers first (needed for dropdown)
    await loadProducts();    // Then load products
    renderDashboard();       // Render dashboard with loaded data
  } catch (err) {
    console.error("Startup error:", err);
    showToast("Startup error: " + err.message, "error");
  } finally {
    if (overlay) overlay.style.display = "none";
  }

  // Re-check DB connection every 30 seconds
  setInterval(checkDBStatus, 30000);
});

// ============================================
//  EXPOSE FUNCTIONS FOR HTML onclick
// ============================================
window.showSection     = showSection;
window.toggleSidebar   = toggleSidebar;
window.closeSidebar    = closeSidebar;
window.logout          = logout;
window.addProduct      = addProduct;
window.deleteProduct   = deleteProduct;
window.editProduct     = editProduct;
window.cancelEdit      = cancelEdit;
window.filterProducts  = filterProducts;
window.addSupplier     = addSupplier;
window.deleteSupplier  = deleteSupplier;
window.filterSuppliers = filterSuppliers;
window.exportToExcel   = exportToExcel;
window.generateInvoice = generateInvoice;
window.changePassword  = changePassword;
window.togglePw        = togglePw;