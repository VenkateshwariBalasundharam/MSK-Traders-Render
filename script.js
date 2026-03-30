/* ============================================
   MSK TRADERS - script.js
   Full update: Billing, Sales History, Users, Dark Mode
============================================ */

const API = window.location.origin + "/api";

// ============================================
//  STATE
// ============================================
let products         = [];
let suppliers        = [];
let sales            = [];
let editingProductId = null;
let stockChartInst, stockChart2Inst, categoryChartInst, salesTrendChartInst;
let currentBillSaleData = null; // for reprinting

// ============================================
//  ROLE HELPERS
// ============================================
function getRole()  { return localStorage.getItem("userRole") || "staff"; }
function isOwner()  { return getRole() === "owner"; }

function applyRolePermissions() {
  const owner = isOwner();

  // ── Sidebar: Manage Users — owner only ──────────
  const usersNav = document.getElementById("usersNavItem");
  if (usersNav) usersNav.style.display = owner ? "" : "none";

  // ── Role badge ───────────────────────────────────
  const badge = document.getElementById("sidebarRoleBadge");
  if (badge) {
    badge.textContent      = owner ? "Owner" : "Staff";
    badge.style.background = owner ? "rgba(245,166,35,0.18)" : "rgba(19,98,168,0.2)";
    badge.style.color      = owner ? "var(--accent)" : "#7ab8f5";
    badge.style.border     = owner ? "1px solid rgba(245,166,35,0.3)" : "1px solid rgba(19,98,168,0.35)";
  }

  if (!owner) {
    // ── Products: staff can ADD but not edit/delete
    //    Keep the add form visible; hide Cancel Edit button only
    const cancelEditBtn = document.getElementById("cancelEdit");
    if (cancelEditBtn) cancelEditBtn.style.display = "none";
    // Hide Export & Invoice header buttons
    document.querySelectorAll("#sec-products .header-actions .btn")
      .forEach(b => b.style.display = "none");

    // ── Suppliers: staff can ADD — keep add card visible ──

    // ── Reports: hide Export CSV & Print ──────────
    document.querySelectorAll("#sec-reports .header-actions .btn")
      .forEach(b => b.style.display = "none");

    // ── Info banners ───────────────────────────────
    _addViewOnlyBanner("sec-products",  "You can add products. Editing &amp; deleting requires Owner access.");
    _addViewOnlyBanner("sec-suppliers", "You can add suppliers. Deleting requires Owner access.");
    _addViewOnlyBanner("sec-reports",   "You can view reports. Exporting requires Owner access.");
  }
}

// Inserts a small info banner at the top of a section for staff
function _addViewOnlyBanner(sectionId, msg) {
  const sec = document.getElementById(sectionId);
  if (!sec || sec.querySelector(".staff-banner")) return;
  const banner = document.createElement("div");
  banner.className = "staff-banner";
  banner.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(19,98,168,0.1);border:1px solid rgba(19,98,168,0.25);border-radius:10px;margin-bottom:14px;font-size:0.83rem;color:#7ab8f5;";
  banner.innerHTML = `<i class="fa-solid fa-circle-info" style="font-size:15px"></i> ${msg}`;
  sec.insertBefore(banner, sec.querySelector(".card") || sec.firstChild);
}

// ============================================
//  API HELPER
// ============================================
async function apiCall(method, endpoint, body = null) {
  const username = localStorage.getItem("adminUser") || "";
  const options  = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Username": username          // sent with every request for server-side role check
    }
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
  const dot = document.getElementById("dbDot");
  const text = document.getElementById("dbStatusText");
  const statusEl = document.getElementById("dbStatus");
  if (!dot) return;
  try {
    const res = await fetch(API + "/status");
    if (res.ok) {
      dot.style.color = "#2ecc71"; text.textContent = "PostgreSQL Connected";
      statusEl.classList.add("connected"); statusEl.classList.remove("error");
    } else throw new Error();
  } catch {
    dot.style.color = "#e74c3c"; text.textContent = "DB Disconnected";
    statusEl.classList.add("error"); statusEl.classList.remove("connected");
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
  toast.innerHTML = `<i class="fa-solid ${type === "success" ? "fa-check-circle" : "fa-circle-exclamation"}"></i> ${message}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 3500);
}

// ============================================
//  NAVIGATION
// ============================================
function showSection(name) {
  // ── Role guard: block staff from users section ──
  if (name === "users" && !isOwner()) {
    showToast("Access denied. Owner only.", "error");
    return;
  }

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
  if (name === "billing")   initBilling();
  if (name === "sales")     loadSales();
  if (name === "users")     loadUsers();
  if (name === "reports")   loadReports();
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

// ============================================
//  LOAD PRODUCTS
// ============================================
async function loadProducts() {
  try {
    const data = await apiCall("GET", "/products");
    products = data.map(p => ({
      id:            p.id,
      name:          p.name           || "",
      batch:         p.batch_no       || "",
      supplier:      p.supplier       || "",
      category:      p.category       || "",
      quantity:      parseInt(p.quantity || 0),
      purchasePrice: parseFloat(p.purchase_price || 0),
      sellingPrice:  parseFloat(p.selling_price  || 0),
      purchaseDate:  formatDate(p.purchase_date  || ""),
      expiry:        formatDate(p.expiry_date     || ""),
      status:        p.status         || "Received"
    }));
    renderTable();
    updateDashboardCards();
    showExpiryAlerts();
    showLowStockSuggestions();
  } catch (err) {
    showToast("Failed to load products: " + err.message, "error");
    const tbody = document.querySelector("#productTable tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" class="table-loading" style="color:var(--red)">⚠ Could not load from database.</td></tr>`;
  }
}

function formatDate(val) {
  if (!val) return "";
  if (typeof val === "string" && val.length === 10 && val.includes("-")) return val;
  if (typeof val === "string" && val.includes("T")) return val.split("T")[0];
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
    showToast("Please fill all required fields (*)", "error"); return;
  }

  const payload = { name, batch_no: batch, supplier, category, quantity,
    purchase_price: purchasePrice, selling_price: sellingPrice,
    purchase_date: document.getElementById("purchaseDate").value || null,
    expiry_date: expiry, status };

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
    showToast("Error saving product: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function deleteProduct(id) {
  if (!isOwner()) { showToast("Access denied. Owner only.", "error"); return; }
  if (!confirm("Delete this product from the database?")) return;
  try {
    await apiCall("DELETE", "/products/" + id);
    showToast("Product deleted.");
    await loadProducts();
  } catch (err) {
    showToast("Delete failed: " + err.message, "error");
  }
}

function editProduct(id) {
  if (!isOwner()) { showToast("Editing requires Owner access.", "error"); return; }
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

function cancelEdit() {
  editingProductId = null;
  clearProductForm();
  document.getElementById("addBtn").innerHTML = '<i class="fa-solid fa-plus"></i> Add Product';
  document.getElementById("cancelEdit").style.display = "none";
}

function clearProductForm() {
  ["productName","batchNo","purchasePrice","sellingPrice","quantity","purchaseDate","expiryDate"]
    .forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("supplier").value = "";
  document.getElementById("category").value = "";
  document.getElementById("status").value   = "Received";
}

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
    tbody.innerHTML = `<tr><td colspan="13" class="table-loading">No products found in database.</td></tr>`;
    return;
  }
  const today = new Date(); today.setHours(0,0,0,0);
  products.forEach((p, i) => {
    const expDate = p.expiry ? new Date(p.expiry) : null;
    const diffDays = expDate ? (expDate - today) / (1000*60*60*24) : null;
    const expiryClass = diffDays === null ? "" : diffDays < 0 ? "expired" : diffDays <= 30 ? "expiring" : "";
    const profit = (p.sellingPrice - p.purchasePrice).toFixed(2);
    const statusTag = p.status === "Pending"
      ? `<span class="tag-pending">Pending</span>`
      : `<span class="tag-received">Received</span>`;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i+1}</td>
      <td><strong>${p.name}</strong></td>
      <td>${p.batch}</td>
      <td>${p.supplier}</td>
      <td>${p.category||"—"}</td>
      <td>${p.quantity}</td>
      <td>₹${p.purchasePrice.toFixed(2)}</td>
      <td>₹${p.sellingPrice.toFixed(2)}</td>
      <td>₹${profit}</td>
      <td>${p.purchaseDate||"—"}</td>
      <td class="${expiryClass}">${p.expiry||"—"}</td>
      <td>${statusTag}</td>
      <td><div class="action-btns">
        ${isOwner() ? `<button class="btn btn-sm btn-edit" onclick="editProduct(${p.id})"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-del" onclick="deleteProduct(${p.id})"><i class="fa-solid fa-trash"></i></button>` : `<span style="font-size:0.75rem;color:var(--text-light)"><i class="fa-solid fa-eye"></i> View only</span>`}
      </div></td>`;
    tbody.appendChild(row);
  });
}

// ============================================
//  SUPPLIERS
// ============================================
async function loadSuppliers() {
  try {
    const data = await apiCall("GET", "/suppliers");
    suppliers = data.map(s => ({ id: s.id, name: s.name||"", contact: s.contact||"" }));
    renderSupplierTable();
    populateSupplierDropdown();
  } catch (err) {
    showToast("Failed to load suppliers: " + err.message, "error");
  }
}

async function addSupplier() {
  const name    = document.getElementById("supplierName").value.trim();
  const contact = document.getElementById("supplierContact").value.trim();
  if (!name || !contact) { showToast("Please fill all supplier fields.", "error"); return; }
  try {
    await apiCall("POST", "/suppliers", { name, contact });
    document.getElementById("supplierName").value = "";
    document.getElementById("supplierContact").value = "";
    showToast("Supplier saved!"); await loadSuppliers();
  } catch (err) { showToast("Error: " + err.message, "error"); }
}

async function deleteSupplier(id) {
  if (!isOwner()) { showToast("Access denied. Owner only.", "error"); return; }
  if (!confirm("Remove this supplier?")) return;
  try {
    await apiCall("DELETE", "/suppliers/" + id);
    showToast("Supplier removed."); await loadSuppliers();
  } catch (err) { showToast("Delete failed: " + err.message, "error"); }
}

function filterSuppliers() {
  const q = document.getElementById("supplierSearch").value.toLowerCase();
  document.querySelectorAll("#supplierTable tbody tr").forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

function renderSupplierTable() {
  const tbody = document.querySelector("#supplierTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!suppliers.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-loading">No suppliers found.</td></tr>`;
    return;
  }
  suppliers.forEach((s, i) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i+1}</td>
      <td><strong>${s.name}</strong></td>
      <td>${s.contact}</td>
      <td><div class="action-btns">
        ${isOwner() ? `<button class="btn btn-sm btn-del" onclick="deleteSupplier(${s.id})"><i class="fa-solid fa-trash"></i></button>` : `<span style="font-size:0.75rem;color:var(--text-light)"><i class="fa-solid fa-eye"></i> View only</span>`}
      </div></td>`;
    tbody.appendChild(row);
  });
}

function populateSupplierDropdown() {
  const select = document.getElementById("supplier");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Select Supplier *</option>';
  suppliers.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.name; opt.textContent = s.name;
    select.appendChild(opt);
  });
  if (current) select.value = current;
}

// ============================================
//  DASHBOARD STATS
// ============================================
function getStats() {
  const today = new Date(); today.setHours(0,0,0,0);
  let low = 0, expiring = 0, expired = 0;
  products.forEach(p => {
    if (p.quantity < 50) low++;
    if (p.expiry) {
      const diff = (new Date(p.expiry) - today) / (1000*60*60*24);
      if (diff < 0) expired++; else if (diff <= 30) expiring++;
    }
  });
  return { total: products.length, low, expiring, expired };
}

function updateDashboardCards() {
  const s = getStats();
  const map = { totalProducts: s.total, lowStock: s.low, expiringSoon: s.expiring, expiredCount: s.expired };
  Object.entries(map).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.textContent = val; });
}

function showExpiryAlerts() {
  const today = new Date(); today.setHours(0,0,0,0);
  const alerts = [];
  products.forEach(p => {
    if (!p.expiry) return;
    const diff = (new Date(p.expiry) - today) / (1000*60*60*24);
    if (diff < 0) alerts.push(`${p.name} (Expired)`);
    else if (diff <= 30) alerts.push(`${p.name} (~${Math.round(diff)}d)`);
  });
  const el = document.getElementById("expiryAlert");
  if (!el) return;
  if (alerts.length) { el.style.display = "block"; el.innerHTML = `⚠ Expiry Alerts: ${alerts.join(" • ")}`; }
  else el.style.display = "none";
}

function showLowStockSuggestions() {
  const box = document.getElementById("lowStockSuggestions");
  if (!box) return;
  const low = products.filter(p => p.quantity < 50);
  if (!low.length) {
    box.innerHTML = `<div class="reorder-empty"><i class="fa-solid fa-check-circle"></i> All medicines have sufficient stock.</div>`;
    return;
  }
  box.innerHTML = low.map(p => `
    <div class="reorder-item">
      <span class="name">${p.name}</span>
      <span class="qty">Qty: ${p.quantity}</span>
    </div>`).join("");
}

async function loadSalesSummary() {
  try {
    const data = await apiCall("GET", "/sales/summary");
    const fmt = v => "₹" + parseFloat(v).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl("todaySales",   fmt(data.today?.today_sales || 0));
    setEl("monthSales",   fmt(data.month?.month_sales || 0));
    setEl("totalSalesAll",fmt(data.total?.total_sales || 0));
    setEl("todayBills",   data.today?.today_bills || 0);
    setEl("sToday", fmt(data.today?.today_sales || 0));
    setEl("sMonth", fmt(data.month?.month_sales || 0));
    setEl("sBills", data.today?.today_bills || 0);
  } catch {}
}

async function renderDashboard() {
  updateDashboardCards();
  showExpiryAlerts();
  showLowStockSuggestions();
  renderStockChart("stockChart");
  await loadSalesSummary();
  renderSalesTrendChart();
}

// ============================================
//  CHARTS
// ============================================
function renderStockChart(canvasId) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (canvasId === "stockChart"  && stockChartInst)  { stockChartInst.destroy();  stockChartInst = null; }
  if (canvasId === "stockChart2" && stockChart2Inst) { stockChart2Inst.destroy(); stockChart2Inst = null; }
  const s = getStats();
  const inst = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Total", "Low Stock", "Expiring Soon", "Expired"],
      datasets: [{ label: "Stock Overview", data: [s.total, s.low, s.expiring, s.expired],
        backgroundColor: ["#1362a8","#f1c40f","#e67e22","#e74c3c"],
        borderRadius: 8, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.05)" } }, x: { grid: { display: false } } }
    }
  });
  if (canvasId === "stockChart")  stockChartInst  = inst;
  if (canvasId === "stockChart2") stockChart2Inst = inst;
}

async function renderSalesTrendChart() {
  const ctx = document.getElementById("salesTrendChart");
  if (!ctx) return;
  if (salesTrendChartInst) { salesTrendChartInst.destroy(); salesTrendChartInst = null; }
  try {
    const data = await apiCall("GET", "/sales/monthly");
    salesTrendChartInst = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.map(d => d.month),
        datasets: [{
          label: "Sales (₹)",
          data: data.map(d => parseFloat(d.total||0)),
          borderColor: "#27ae60", backgroundColor: "rgba(39,174,96,0.1)",
          tension: 0.4, fill: true, pointBackgroundColor: "#27ae60",
          pointRadius: 5, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.05)" },
            ticks: { callback: v => "₹" + v.toLocaleString("en-IN") } },
          x: { grid: { display: false } }
        }
      }
    });
  } catch {}
}

function renderCategoryChart() {
  const ctx = document.getElementById("categoryChart");
  if (!ctx) return;
  if (categoryChartInst) { categoryChartInst.destroy(); categoryChartInst = null; }
  const cats = {};
  products.forEach(p => { const c = p.category || "Other"; cats[c] = (cats[c]||0) + 1; });
  if (!Object.keys(cats).length) return;
  categoryChartInst = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(cats),
      datasets: [{ data: Object.values(cats),
        backgroundColor: ["#1362a8","#f5a623","#27ae60","#e74c3c","#9b59b6","#16a085","#e67e22"],
        borderWidth: 2, borderColor: "var(--card-bg)" }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { font: { size: 12 }, padding: 12 } } }
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
    container.innerHTML = `<p style="padding:20px;color:var(--green);font-weight:600">✅ All stock levels are healthy.</p>`;
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>Product</th><th>Supplier</th><th>Qty</th><th>Expiry</th></tr></thead>
      <tbody>${low.map((p,i) => `
        <tr>
          <td>${i+1}</td>
          <td><strong>${p.name}</strong></td>
          <td>${p.supplier}</td>
          <td style="color:var(--red);font-weight:700">${p.quantity}</td>
          <td>${p.expiry||"—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

// ============================================
//  BILLING MODULE
// ============================================
let billRows = [];

function initBilling() {
  if (billRows.length === 0) addBillRow();
  updateBillSummary();
}

function addBillRow() {
  const id = Date.now();
  billRows.push({ id, product_id: null, product_name: "", batch_no: "", unit_price: 0, quantity: 1, discount_pct: 0 });
  renderBillRows();
}

function removeBillRow(id) {
  billRows = billRows.filter(r => r.id !== id);
  if (!billRows.length) addBillRow();
  renderBillRows();
  updateBillSummary();
}

function renderBillRows() {
  const container = document.getElementById("billItemsContainer");
  if (!container) return;
  container.innerHTML = "";
  billRows.forEach(row => {
    const div = document.createElement("div");
    div.className = "bill-item-row";
    div.dataset.rowId = row.id;
    div.innerHTML = `
      <div class="product-search-wrap">
        <input type="text" class="bill-product-input" placeholder="Search product..." value="${row.product_name}"
          oninput="searchBillProduct(${row.id}, this.value)"
          onfocus="openProductDropdown(${row.id})"
          autocomplete="off">
        <div class="product-dropdown" id="pd-${row.id}">
          ${buildProductDropdownHTML(row.id, "")}
        </div>
      </div>
      <input type="number" placeholder="Qty" min="1" value="${row.quantity}"
        onchange="updateBillRow(${row.id},'quantity',this.value)">
      <input type="number" placeholder="Price ₹" min="0" step="0.01" value="${row.unit_price||""}"
        onchange="updateBillRow(${row.id},'unit_price',this.value)">
      <input type="number" placeholder="Disc%" min="0" max="100" step="0.01" value="${row.discount_pct||""}"
        oninput="updateBillRow(${row.id},'discount_pct',this.value)">
      <button class="bill-remove-btn" onclick="removeBillRow(${row.id})"><i class="fa-solid fa-xmark"></i></button>`;
    container.appendChild(div);
  });
}

function buildProductDropdownHTML(rowId, query) {
  const q = query.toLowerCase();
  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(q) || p.batch.toLowerCase().includes(q)
  ).slice(0, 12);
  if (!filtered.length) return `<div class="product-dropdown-item" style="color:var(--text-light)">No products found</div>`;
  return filtered.map(p => `
    <div class="product-dropdown-item" onclick="selectBillProduct(${rowId}, ${p.id})">
      <div>
        <strong>${p.name}</strong>
        <div class="stock">Batch: ${p.batch} &nbsp;|&nbsp; Stock: ${p.quantity}</div>
      </div>
      <span class="price">₹${p.sellingPrice.toFixed(2)}</span>
    </div>`).join("");
}

function searchBillProduct(rowId, query) {
  const dd = document.getElementById("pd-" + rowId);
  if (dd) { dd.innerHTML = buildProductDropdownHTML(rowId, query); dd.classList.add("open"); }
  const row = billRows.find(r => r.id === rowId);
  if (row) { row.product_name = query; row.product_id = null; }
}

function openProductDropdown(rowId) {
  const dd = document.getElementById("pd-" + rowId);
  if (dd) { dd.innerHTML = buildProductDropdownHTML(rowId, ""); dd.classList.add("open"); }
}

function selectBillProduct(rowId, productId) {
  const p   = products.find(p => p.id === productId);
  const row = billRows.find(r => r.id === rowId);
  if (!p || !row) return;
  row.product_id   = p.id;
  row.product_name = p.name;
  row.batch_no     = p.batch;
  row.unit_price   = p.sellingPrice;
  const dd = document.getElementById("pd-" + rowId);
  if (dd) dd.classList.remove("open");
  renderBillRows();
  updateBillSummary();
}

function updateBillRow(rowId, field, value) {
  const row = billRows.find(r => r.id === rowId);
  if (row) {
    row[field] = field === "quantity" ? parseInt(value)||1
               : field === "unit_price" || field === "discount_pct" ? parseFloat(value)||0
               : value;
    updateBillSummary();
  }
}

// ============================================
//  ✅ FIXED: Auto-calculate discount amount from disc% rows
// ============================================
function updateBillSummary() {
  let grossTotal = 0;  // original price before disc%
  let netTotal   = 0;  // price after disc% applied per row

  billRows.forEach(row => {
    const gross = row.quantity * row.unit_price;
    const net   = gross * (1 - (row.discount_pct || 0) / 100);
    grossTotal += gross;
    netTotal   += net;
  });

  // Auto-fill Discount (₹) with total discount from all disc% rows
  const rowDiscountAmt = grossTotal - netTotal;
  const discEl = document.getElementById("billDiscount");
  if (discEl) discEl.value = rowDiscountAmt.toFixed(2);

  const fmt     = v => "₹" + v.toFixed(2);
  const setSafe = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  setSafe("billSubtotal", fmt(grossTotal));   // show gross before discount
  setSafe("billTotal",    fmt(netTotal));      // show net after discount
}

function clearBill() {
  billRows = [];
  addBillRow();
  const cust  = document.getElementById("billCustomer");
  const phone = document.getElementById("billPhone");
  const disc  = document.getElementById("billDiscount");
  if (cust)  cust.value  = "";
  if (phone) phone.value = "";
  if (disc)  disc.value  = "0";
  updateBillSummary();
}

async function finalizeBill() {
  const validRows = billRows.filter(r => r.product_id && r.quantity > 0);
  if (!validRows.length) {
    showToast("Please add at least one product to the bill.", "error"); return;
  }
  for (const row of validRows) {
    const p = products.find(p => p.id === row.product_id);
    if (p && row.quantity > p.quantity) {
      showToast(`Insufficient stock for ${p.name}. Available: ${p.quantity}`, "error"); return;
    }
  }

  const customer = document.getElementById("billCustomer")?.value.trim() || "Walk-in Customer";
  const discount = parseFloat(document.getElementById("billDiscount")?.value) || 0;
  const sold_by  = localStorage.getItem("adminUser") || "admin";

  const items = validRows.map(r => ({
    product_id: r.product_id, product_name: r.product_name, batch_no: r.batch_no,
    quantity: r.quantity, unit_price: r.unit_price, discount_pct: r.discount_pct
  }));

  try {
    const data = await apiCall("POST", "/sales", { customer, items, discount, sold_by });
    showToast("Bill created successfully! Printing...");
    printBill(data.sale, data.items);
    await loadProducts();
    clearBill();
  } catch (err) {
    showToast("Error creating bill: " + err.message, "error");
  }
}

function printBill(sale, items) {
  const rows = items.map((item, i) => `
    <tr>
      <td>${i+1}</td><td>${item.product_name}</td><td>${item.batch_no||"—"}</td>
      <td>${item.quantity}</td><td>₹${parseFloat(item.unit_price).toFixed(2)}</td>
      <td>${item.discount_pct||0}%</td><td>₹${parseFloat(item.line_total||item._lineTotal||0).toFixed(2)}</td>
    </tr>`).join("");

  const win = window.open("","_blank");
  win.document.write(`<!DOCTYPE html><html><head>
    <title>Bill – ${sale.bill_no}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 28px; color: #1a2b45; max-width: 720px; margin: auto; }
      .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; padding-bottom:16px; border-bottom:2px solid #0b2545; }
      h1 { font-size:26px; letter-spacing:3px; color:#0b2545; margin:0; }
      .sub { color:#6b7a99; font-size:13px; margin-top:4px; }
      .bill-meta { text-align:right; font-size:13px; color:#555; }
      .bill-meta strong { display:block; font-size:15px; color:#0b2545; }
      table { width:100%; border-collapse:collapse; margin-top:16px; }
      th { background:#0b2545; color:white; padding:10px; text-align:left; font-size:12px; }
      td { padding:9px 10px; border-bottom:1px solid #dde3f0; font-size:13px; }
      tr:hover { background:#f7f9ff; }
      .totals { margin-top:18px; }
      .total-row { display:flex; justify-content:space-between; padding:6px 0; font-size:14px; }
      .total-row.grand { font-size:17px; font-weight:700; color:#27ae60; border-top:2px solid #dde3f0; padding-top:10px; margin-top:6px; }
      .footer { margin-top:28px; text-align:center; font-size:12px; color:#aaa; border-top:1px dashed #ccc; padding-top:14px; }
      @media print { button { display:none; } }
    </style>
  </head><body>
  <div class="header">
    <div>
      <h1>MSK TRADERS</h1>
      <div class="sub">Pharmacy Management System</div>
    </div>
    <div class="bill-meta">
      <strong>${sale.bill_no}</strong>
      ${new Date(sale.createdAt||Date.now()).toLocaleString("en-IN")}<br>
      Customer: <strong>${sale.customer}</strong><br>
      Sold by: ${sale.sold_by}
    </div>
  </div>
  <button onclick="window.print()" style="padding:8px 18px;background:#0b2545;color:white;border:none;border-radius:6px;cursor:pointer;margin-bottom:16px">
    🖨 Print Receipt
  </button>
  <table>
    <thead><tr><th>#</th><th>Product</th><th>Batch</th><th>Qty</th><th>Price</th><th>Disc%</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="total-row"><span>Subtotal</span><span>₹${parseFloat(sale.total_amount).toFixed(2)}</span></div>
    <div class="total-row"><span>Discount</span><span>–₹${parseFloat(sale.discount||0).toFixed(2)}</span></div>
    <div class="total-row grand"><span>TOTAL PAID</span><span>₹${parseFloat(sale.final_amount).toFixed(2)}</span></div>
  </div>
  <div class="footer">Thank you for your purchase! • MSK Traders</div>
  </body></html>`);
  win.document.close();
}

// ============================================
//  SALES HISTORY
// ============================================
async function loadSales() {
  await loadSalesSummary();
  const tbody = document.querySelector("#salesTable tbody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="table-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>`;
  try {
    let endpoint = "/sales";
    const from = document.getElementById("salesFrom")?.value;
    const to   = document.getElementById("salesTo")?.value;
    if (from && to) endpoint += `?from=${from}&to=${to}`;
    sales = await apiCall("GET", endpoint);
    renderSalesTable();
  } catch (err) {
    showToast("Failed to load sales: " + err.message, "error");
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="table-loading" style="color:var(--red)">⚠ Error loading sales.</td></tr>`;
  }
}

function clearSalesFilter() {
  const from = document.getElementById("salesFrom");
  const to   = document.getElementById("salesTo");
  if (from) from.value = ""; if (to) to.value = "";
  loadSales();
}

function filterSalesTable() {
  const q = document.getElementById("salesSearch").value.toLowerCase();
  document.querySelectorAll("#salesTable tbody tr").forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

function renderSalesTable() {
  const tbody = document.querySelector("#salesTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!sales.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="table-loading">No sales records found.</td></tr>`;
    return;
  }
  sales.forEach((s, i) => {
    const row = document.createElement("tr");
    const dt  = new Date(s.createdAt).toLocaleString("en-IN", { dateStyle:"short", timeStyle:"short" });
    row.innerHTML = `
      <td>${i+1}</td>
      <td><strong>${s.bill_no}</strong></td>
      <td>${s.customer}</td>
      <td>—</td>
      <td>₹${parseFloat(s.total_amount).toFixed(2)}</td>
      <td>₹${parseFloat(s.discount||0).toFixed(2)}</td>
      <td><strong style="color:var(--green)">₹${parseFloat(s.final_amount).toFixed(2)}</strong></td>
      <td>${s.sold_by}</td>
      <td>${dt}</td>
      <td><div class="action-btns">
        <button class="btn btn-sm btn-edit" onclick="viewBillDetails(${s.id})"><i class="fa-solid fa-eye"></i></button>
        ${isOwner() ? `<button class="btn btn-sm btn-del" onclick="deleteSale(${s.id})"><i class="fa-solid fa-trash"></i></button>` : ""}
      </div></td>`;
    tbody.appendChild(row);
    loadBillItemCount(s.id, row.cells[3]);
  });
}

async function loadBillItemCount(saleId, cell) {
  try {
    const items = await apiCall("GET", `/sales/${saleId}/items`);
    cell.textContent = items.length + (items.length === 1 ? " item" : " items");
  } catch { cell.textContent = "—"; }
}

async function viewBillDetails(saleId) {
  const sale = sales.find(s => s.id === saleId);
  if (!sale) return;
  currentBillSaleData = sale;
  document.getElementById("billDetailsTitle").textContent    = "Bill: " + sale.bill_no;
  document.getElementById("billDetailsCustomer").textContent = sale.customer;
  document.getElementById("bdSubtotal").textContent = "₹" + parseFloat(sale.total_amount).toFixed(2);
  document.getElementById("bdDiscount").textContent = "₹" + parseFloat(sale.discount||0).toFixed(2);
  document.getElementById("bdTotal").textContent    = "₹" + parseFloat(sale.final_amount).toFixed(2);

  const tbody = document.querySelector("#billDetailsTable tbody");
  tbody.innerHTML = `<tr><td colspan="7" class="table-loading"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>`;
  document.getElementById("billDetailsModal").classList.add("open");

  try {
    const items = await apiCall("GET", `/sales/${saleId}/items`);
    currentBillSaleData._items = items;
    tbody.innerHTML = items.map((it, i) => `
      <tr>
        <td>${i+1}</td>
        <td><strong>${it.product_name}</strong></td>
        <td>${it.batch_no||"—"}</td>
        <td>${it.quantity}</td>
        <td>₹${parseFloat(it.unit_price).toFixed(2)}</td>
        <td>${it.discount_pct||0}%</td>
        <td>₹${parseFloat(it.line_total).toFixed(2)}</td>
      </tr>`).join("");
  } catch { tbody.innerHTML = `<tr><td colspan="7" class="table-loading">Error loading items.</td></tr>`; }
}

function reprintBill() {
  if (!currentBillSaleData) return;
  printBill(currentBillSaleData, currentBillSaleData._items || []);
}

async function deleteSale(id) {
  if (!isOwner()) { showToast("Access denied. Owner only.", "error"); return; }
  if (!confirm("Delete this bill? This cannot be undone.")) return;
  try {
    await apiCall("DELETE", "/sales/" + id);
    showToast("Bill deleted."); loadSales();
  } catch (err) { showToast("Delete failed: " + err.message, "error"); }
}

// ============================================
//  USER MANAGEMENT
// ============================================
async function loadUsers() {
  const container = document.getElementById("usersListContainer");
  if (!container) return;
  container.innerHTML = `<p class="table-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</p>`;
  try {
    const users = await apiCall("GET", "/users");
    if (!users.length) { container.innerHTML = `<p class="table-loading">No users found.</p>`; return; }
    container.innerHTML = users.map(u => `
      <div class="user-card">
        <div class="user-info">
          <div class="user-avatar ${u.role}">${u.username[0].toUpperCase()}</div>
          <div>
            <div class="user-name">${u.username}</div>
            <div class="user-meta">Last updated: ${new Date(u.updatedAt).toLocaleDateString("en-IN")}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="tag-${u.role}">${u.role.charAt(0).toUpperCase()+u.role.slice(1)}</span>
          ${u.username !== localStorage.getItem("adminUser") ? `
          <button class="btn btn-sm btn-del" onclick="deleteUser(${u.id},'${u.username}')">
            <i class="fa-solid fa-trash"></i>
          </button>` : `<span style="font-size:0.75rem;color:var(--text-light)">(you)</span>`}
        </div>
      </div>`).join("");
  } catch (err) {
    container.innerHTML = `<p class="table-loading" style="color:var(--red)">Error loading users.</p>`;
  }
}

async function addUser() {
  if (!isOwner()) { showToast("Access denied. Owner only.", "error"); return; }
  const username = document.getElementById("newUsername").value.trim();
  const password = document.getElementById("newUserPassword").value;
  const role     = document.getElementById("newUserRole").value;
  const msgBox   = document.getElementById("addUserMsg");
  const btn      = document.getElementById("addUserBtn");

  const showMsg = (msg, type) => {
    msgBox.style.display = "block";
    msgBox.style.background = type==="error" ? "rgba(231,76,60,0.1)" : "rgba(39,174,96,0.1)";
    msgBox.style.border = type==="error" ? "1px solid rgba(231,76,60,0.4)" : "1px solid rgba(39,174,96,0.4)";
    msgBox.style.color = type==="error" ? "#e74c3c" : "#27ae60";
    msgBox.innerHTML = `<i class="fa-solid ${type==="error"?"fa-circle-exclamation":"fa-check-circle"}"></i> ${msg}`;
  };

  if (!username || !password) { showMsg("Username and password are required.","error"); return; }
  if (password.length < 4)    { showMsg("Password must be at least 4 characters.","error"); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';

  try {
    await apiCall("POST", "/users", { username, password, role });
    showMsg("User created successfully!","success");
    setTimeout(() => { document.getElementById("addUserModal").classList.remove("open"); loadUsers(); }, 1500);
  } catch (err) {
    showMsg(err.message || "Failed to create user.","error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create User';
  }
}

async function deleteUser(id, username) {
  if (!isOwner()) { showToast("Access denied. Owner only.", "error"); return; }
  if (!confirm(`Remove user "${username}"? They will no longer be able to log in.`)) return;
  try {
    await apiCall("DELETE", "/users/" + id);
    showToast("User removed."); loadUsers();
  } catch (err) { showToast(err.message || "Delete failed.", "error"); }
}

// ============================================
//  EXPORT TO CSV
// ============================================
function exportToExcel() {
  if (!products.length) { showToast("No products to export.", "error"); return; }
  const headers = ["#","Product","Batch","Supplier","Category","Qty","Purchase Price","Selling Price","Profit","Expiry","Status"];
  const rows = products.map((p,i) => [
    i+1, p.name, p.batch, p.supplier, p.category||"", p.quantity,
    p.purchasePrice.toFixed(2), p.sellingPrice.toFixed(2),
    (p.sellingPrice-p.purchasePrice).toFixed(2), p.expiry, p.status
  ]);
  const csv  = [headers,...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type:"text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "MSK_Traders_Inventory.csv"; a.click();
  URL.revokeObjectURL(url);
  showToast("Exported successfully!");
}

// ============================================
//  GENERATE INVOICE
// ============================================
function generateInvoice() {
  if (!products.length) { showToast("No products for invoice.", "error"); return; }
  const rows = products.map((p,i) => `
    <tr>
      <td>${i+1}</td><td>${p.name}</td><td>${p.batch}</td><td>${p.quantity}</td>
      <td>₹${p.purchasePrice.toFixed(2)}</td><td>₹${p.sellingPrice.toFixed(2)}</td>
      <td>₹${(p.sellingPrice-p.purchasePrice).toFixed(2)}</td><td>${p.expiry}</td>
    </tr>`).join("");
  const totalProfit = products.reduce((sum,p) => sum+(p.sellingPrice-p.purchasePrice)*p.quantity, 0);
  const win = window.open("","_blank");
  win.document.write(`<!DOCTYPE html><html><head>
    <title>MSK Traders Invoice</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;color:#1a2b45}
      h1{font-size:28px;letter-spacing:3px;color:#0b2545}
      .sub{color:#6b7a99;font-size:13px;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;margin-top:20px}
      th{background:#0b2545;color:white;padding:10px;text-align:left;font-size:12px}
      td{padding:9px 10px;border-bottom:1px solid #dde3f0;font-size:13px}
      tr:hover{background:#f7f9ff}
      .total{margin-top:20px;font-size:16px;font-weight:700;color:#27ae60}
      @media print{button{display:none}}
    </style></head><body>
    <h1>MSK TRADERS</h1>
    <p class="sub">Stock Invoice — ${new Date().toLocaleDateString("en-IN",{dateStyle:"long"})}</p>
    <button onclick="window.print()" style="padding:8px 18px;background:#0b2545;color:white;border:none;border-radius:6px;cursor:pointer">Print</button>
    <table>
      <thead><tr><th>#</th><th>Product</th><th>Batch</th><th>Qty</th><th>Purchase</th><th>Selling</th><th>Profit</th><th>Expiry</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="total">Total Estimated Profit: ₹${totalProfit.toFixed(2)}</p>
    </body></html>`);
  win.document.close();
}

// ============================================
//  CLOSE DROPDOWNS ON CLICK OUTSIDE
// ============================================
document.addEventListener("click", e => {
  if (!e.target.closest(".product-search-wrap")) {
    document.querySelectorAll(".product-dropdown").forEach(d => d.classList.remove("open"));
  }
});

// ============================================
//  INIT
// ============================================
document.addEventListener("DOMContentLoaded", async () => {
  const overlay = document.getElementById("loadingOverlay");

  const user = localStorage.getItem("adminUser") || "admin";
  const role = localStorage.getItem("userRole")  || "";
  const sidebarUser = document.getElementById("sidebarUser");
  const dashUser    = document.getElementById("dashUser");
  if (sidebarUser) sidebarUser.textContent = user;
  if (dashUser)    dashUser.textContent    = user;

  applyRolePermissions();

  try {
    await checkDBStatus();
    await loadSuppliers();
    await loadProducts();
    renderDashboard();
    initBilling();
  } catch (err) {
    console.error("Startup error:", err);
    showToast("Startup error: " + err.message, "error");
  } finally {
    if (overlay) overlay.style.display = "none";
  }

  setInterval(checkDBStatus, 30000);
});

// ============================================
//  REPORTS MODULE
// ============================================
let rptBarChartInst = null, rptPieChartInst = null, rptTrendChartInst = null;
let rptProductData = []; // cached for filter

function initReportFilters() {
  const now = new Date();
  const monthSel = document.getElementById("reportMonth");
  const yearSel  = document.getElementById("reportYear");
  if (!monthSel || !yearSel) return;

  // Populate year dropdown (current year back 3 years)
  if (!yearSel.options.length) {
    const cy = now.getFullYear();
    for (let y = cy; y >= cy - 3; y--) {
      const opt = document.createElement("option");
      opt.value = y; opt.textContent = y;
      yearSel.appendChild(opt);
    }
  }
  // Set defaults to current month/year only on first call
  if (!monthSel.dataset.init) {
    monthSel.value = now.getMonth() + 1;
    yearSel.value  = now.getFullYear();
    monthSel.dataset.init = "1";
  }
}

async function loadReports() {
  initReportFilters();
  const month    = parseInt(document.getElementById("reportMonth")?.value || new Date().getMonth() + 1);
  const year     = parseInt(document.getElementById("reportYear")?.value  || new Date().getFullYear());
  const viewMode = document.getElementById("reportView")?.value || "month";

  // Show/hide trend card
  const trendCard = document.getElementById("rptTrendCard");
  if (trendCard) trendCard.style.display = viewMode === "year" ? "" : "none";

  // Build date range
  let fromDate, toDate;
  if (viewMode === "year") {
    fromDate = `${year}-01-01`;
    toDate   = `${year}-12-31`;
  } else {
    const lastDay = new Date(year, month, 0).getDate();
    fromDate = `${year}-${String(month).padStart(2,"0")}-01`;
    toDate   = `${year}-${String(month).padStart(2,"0")}-${lastDay}`;
  }

  try {
    // 1. Fetch sales for the period
    const salesData = await apiCall("GET", `/sales?from=${fromDate}&to=${toDate}`);

    // 2. Compute revenue/discount totals from sales
    let totalRevenue  = 0, totalDiscount = 0, totalNetRevenue = 0;
    salesData.forEach(s => {
      totalRevenue    += parseFloat(s.total_amount || 0);
      totalDiscount   += parseFloat(s.discount || 0);
      totalNetRevenue += parseFloat(s.final_amount || 0);
    });

    // 3. Fetch sale items for product breakdown
    const allItems = [];
    for (const sale of salesData) {
      try {
        const items = await apiCall("GET", `/sales/${sale.id}/items`);
        items.forEach(it => it._saleDate = sale.createdAt || sale["createdAt"]);
        allItems.push(...items);
      } catch {}
    }

    // 4. Aggregate per product
    const productMap = {};
    allItems.forEach(it => {
      const key = it.product_name || "Unknown";
      if (!productMap[key]) {
        // Look up product details from local cache
        const local = products.find(p => p.id === it.product_id);
        productMap[key] = {
          name:          key,
          category:      local?.category || "—",
          purchasePrice: parseFloat(local?.purchasePrice || 0),
          sellingPrice:  parseFloat(local?.sellingPrice  || it.unit_price || 0),
          qtySold:       0,
          revenue:       0,
          cost:          0
        };
      }
      const qty  = parseInt(it.quantity || 0);
      const rev  = parseFloat(it.line_total || 0);
      productMap[key].qtySold  += qty;
      productMap[key].revenue  += rev;
      productMap[key].cost     += productMap[key].purchasePrice * qty;
    });

    rptProductData = Object.values(productMap).map(p => ({
      ...p,
      profit: p.revenue - p.cost,
      margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100) : 0
    })).sort((a, b) => b.revenue - a.revenue);

    // 5. Totals
    const totalCost   = rptProductData.reduce((s, p) => s + p.cost,   0);
    const totalProfit = rptProductData.reduce((s, p) => s + p.profit, 0);
    const netPL       = totalNetRevenue - totalCost;

    // 6. Update KPI cards
    const fmt = v => "₹" + Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl("rptRevenue", fmt(totalNetRevenue));
    setEl("rptCost",    fmt(totalCost));
    setEl("rptProfit",  fmt(totalProfit));
    setEl("rptPL",      (netPL >= 0 ? "+" : "-") + fmt(netPL));

    // Color P&L card
    const plCard = document.getElementById("rptPLCard");
    const plIcon = document.getElementById("rptPLIcon");
    if (plCard && plIcon) {
      const pos = netPL >= 0;
      plCard.style.background = pos
        ? "linear-gradient(135deg,rgba(39,174,96,0.12),rgba(39,174,96,0.04))"
        : "linear-gradient(135deg,rgba(231,76,60,0.12),rgba(231,76,60,0.04))";
      plCard.style.border = pos ? "1px solid rgba(39,174,96,0.3)" : "1px solid rgba(231,76,60,0.3)";
      plIcon.style.background = pos ? "rgba(39,174,96,0.12)" : "rgba(231,76,60,0.12)";
      plIcon.style.color      = pos ? "var(--green)" : "var(--red)";
      document.getElementById("rptPL").style.color = pos ? "var(--green)" : "var(--red)";
    }

    // 7. Render product table
    renderReportProductTable();

    // 8. Charts
    renderRptBarChart(totalNetRevenue, totalCost, totalProfit);
    renderRptPieChart(totalNetRevenue, totalCost, totalDiscount);

    // 9. Monthly summary table
    await renderMonthlyTable(year, viewMode, month);

    // 10. Trend chart (year only)
    if (viewMode === "year") await renderRptTrendChart(year);

  } catch (err) {
    showToast("Report load failed: " + err.message, "error");
  }
}

function renderReportProductTable() {
  const q     = (document.getElementById("rptProductSearch")?.value || "").toLowerCase();
  const tbody = document.querySelector("#rptProductTable tbody");
  if (!tbody) return;
  const filtered = q ? rptProductData.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) : rptProductData;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="table-loading" style="color:var(--text-light)">No product sales found for this period.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((p, i) => {
    const profitColor = p.profit >= 0 ? "var(--green)" : "var(--red)";
    const statusTag   = p.profit >= 0
      ? `<span class="tag-received">Profit</span>`
      : `<span class="tag-pending">Loss</span>`;
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${p.name}</strong></td>
      <td>${p.category}</td>
      <td>${p.qtySold}</td>
      <td>₹${p.purchasePrice.toFixed(2)}</td>
      <td>₹${p.sellingPrice.toFixed(2)}</td>
      <td>₹${p.revenue.toFixed(2)}</td>
      <td>₹${p.cost.toFixed(2)}</td>
      <td style="color:${profitColor};font-weight:700">₹${Math.abs(p.profit).toFixed(2)}</td>
      <td>${p.margin.toFixed(1)}%</td>
      <td>${statusTag}</td>
    </tr>`;
  }).join("");
}

function filterReportTable() {
  renderReportProductTable();
}

function renderRptBarChart(revenue, cost, profit) {
  const ctx = document.getElementById("rptBarChart");
  if (!ctx) return;
  if (rptBarChartInst) { rptBarChartInst.destroy(); rptBarChartInst = null; }
  rptBarChartInst = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Revenue", "Purchase Cost", "Gross Profit"],
      datasets: [{
        data: [revenue, cost, profit],
        backgroundColor: ["#1362a8","#e67e22", profit >= 0 ? "#27ae60" : "#e74c3c"],
        borderRadius: 8, borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.05)" },
             ticks: { callback: v => "₹" + v.toLocaleString("en-IN") } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderRptPieChart(revenue, cost, discount) {
  const ctx = document.getElementById("rptPieChart");
  if (!ctx) return;
  if (rptPieChartInst) { rptPieChartInst.destroy(); rptPieChartInst = null; }
  const profit = revenue - cost;
  rptPieChartInst = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Net Profit", "Purchase Cost", "Discounts Given"],
      datasets: [{ data: [Math.max(profit, 0), cost, discount],
        backgroundColor: ["#27ae60","#1362a8","#f5a623"],
        borderWidth: 2, borderColor: "var(--card-bg)" }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { font: { size: 12 }, padding: 12 } } }
    }
  });
}

async function renderRptTrendChart(year) {
  const ctx = document.getElementById("rptTrendChart");
  if (!ctx) return;
  if (rptTrendChartInst) { rptTrendChartInst.destroy(); rptTrendChartInst = null; }
  try {
    // Fetch monthly breakdown for the year
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const lastDay = new Date(year, m, 0).getDate();
      const from = `${year}-${String(m).padStart(2,"0")}-01`;
      const to   = `${year}-${String(m).padStart(2,"0")}-${lastDay}`;
      const data = await apiCall("GET", `/sales?from=${from}&to=${to}`);
      const net  = data.reduce((s, r) => s + parseFloat(r.final_amount || 0), 0);
      months.push({ label: new Date(year, m-1).toLocaleString("en-IN",{month:"short"}), net });
    }
    rptTrendChartInst = new Chart(ctx, {
      type: "line",
      data: {
        labels: months.map(m => m.label),
        datasets: [{
          label: "Net Revenue (₹)",
          data: months.map(m => m.net),
          borderColor: "#27ae60", backgroundColor: "rgba(39,174,96,0.1)",
          tension: 0.4, fill: true, pointBackgroundColor: "#27ae60",
          pointRadius: 5, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => "₹" + v.toLocaleString("en-IN") } },
          x: { grid: { display: false } }
        }
      }
    });
  } catch {}
}

async function renderMonthlyTable(year, viewMode, selectedMonth) {
  const tbody = document.querySelector("#rptMonthlyTable tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="table-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>`;

  const monthsToShow = viewMode === "year"
    ? Array.from({length: 12}, (_, i) => i + 1)
    : [selectedMonth];

  const rows = [];
  for (const m of monthsToShow) {
    const lastDay = new Date(year, m, 0).getDate();
    const from = `${year}-${String(m).padStart(2,"0")}-01`;
    const to   = `${year}-${String(m).padStart(2,"0")}-${lastDay}`;
    try {
      const data = await apiCall("GET", `/sales?from=${from}&to=${to}`);
      const bills   = data.length;
      const revenue = data.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
      const discounts = data.reduce((s, r) => s + parseFloat(r.discount || 0), 0);
      const net     = data.reduce((s, r) => s + parseFloat(r.final_amount || 0), 0);
      const label   = new Date(year, m-1).toLocaleString("en-IN", { month: "long" }) + " " + year;
      rows.push({ label, bills, revenue, discounts, net });
    } catch {
      const label = new Date(year, m-1).toLocaleString("en-IN", { month: "long" }) + " " + year;
      rows.push({ label, bills: 0, revenue: 0, discounts: 0, net: 0 });
    }
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-loading" style="color:var(--text-light)">No data found.</td></tr>`;
    return;
  }

  const fmt = v => "₹" + parseFloat(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  tbody.innerHTML = rows.map(r => `<tr>
    <td><strong>${r.label}</strong></td>
    <td>${r.bills}</td>
    <td>${fmt(r.revenue)}</td>
    <td style="color:var(--orange)">${fmt(r.discounts)}</td>
    <td style="color:var(--green);font-weight:700">${fmt(r.net)}</td>
  </tr>`).join("");
}

function exportReportCSV() {
  if (!rptProductData.length) { showToast("No report data to export.", "error"); return; }
  const headers = ["#","Product","Category","Qty Sold","Purchase Price","Selling Price","Revenue","Cost","Profit","Margin %","Status"];
  const rows = rptProductData.map((p, i) => [
    i+1, p.name, p.category, p.qtySold,
    p.purchasePrice.toFixed(2), p.sellingPrice.toFixed(2),
    p.revenue.toFixed(2), p.cost.toFixed(2),
    p.profit.toFixed(2), p.margin.toFixed(1) + "%",
    p.profit >= 0 ? "Profit" : "Loss"
  ]);
  const month  = document.getElementById("reportMonth")?.value || "";
  const year   = document.getElementById("reportYear")?.value  || "";
  const csv    = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob   = new Blob([csv], { type: "text/csv" });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement("a");
  a.href = url; a.download = `MSK_Report_${month}_${year}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast("Report exported!");
}

function printReport() {
  const month = document.getElementById("reportMonth");
  const year  = document.getElementById("reportYear");
  const mLabel = month?.options[month.selectedIndex]?.text || "";
  const yLabel = year?.value || "";

  const rev  = document.getElementById("rptRevenue")?.textContent || "—";
  const cost = document.getElementById("rptCost")?.textContent    || "—";
  const profit = document.getElementById("rptProfit")?.textContent || "—";
  const pl   = document.getElementById("rptPL")?.textContent      || "—";

  const rows = rptProductData.map((p, i) => `<tr>
    <td>${i+1}</td><td>${p.name}</td><td>${p.category}</td><td>${p.qtySold}</td>
    <td>₹${p.purchasePrice.toFixed(2)}</td><td>₹${p.sellingPrice.toFixed(2)}</td>
    <td>₹${p.revenue.toFixed(2)}</td><td>₹${p.cost.toFixed(2)}</td>
    <td style="color:${p.profit>=0?"#27ae60":"#e74c3c"};font-weight:700">₹${Math.abs(p.profit).toFixed(2)}</td>
    <td>${p.margin.toFixed(1)}%</td>
    <td>${p.profit>=0?"Profit":"Loss"}</td>
  </tr>`).join("");

  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html><head>
    <title>MSK Traders Report</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;color:#1a2b45}
      h1{font-size:24px;letter-spacing:3px;color:#0b2545;margin:0}
      .sub{color:#6b7a99;font-size:12px;margin-bottom:20px}
      .kpis{display:flex;gap:20px;margin:16px 0;flex-wrap:wrap}
      .kpi{background:#f0f4fa;border-radius:10px;padding:14px 20px;min-width:160px}
      .kpi .label{font-size:11px;color:#6b7a99;text-transform:uppercase;letter-spacing:1px}
      .kpi .val{font-size:1.4rem;font-weight:700;color:#0b2545;margin-top:4px}
      table{width:100%;border-collapse:collapse;margin-top:20px;font-size:12px}
      th{background:#0b2545;color:white;padding:8px 10px;text-align:left}
      td{padding:7px 10px;border-bottom:1px solid #dde3f0}
      tr:hover{background:#f7f9ff}
      @media print{button{display:none}}
    </style></head><body>
    <h1>MSK TRADERS — REPORT</h1>
    <p class="sub">Period: ${mLabel} ${yLabel} &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString("en-IN",{dateStyle:"long"})}</p>
    <button onclick="window.print()" style="padding:8px 18px;background:#0b2545;color:white;border:none;border-radius:6px;cursor:pointer">🖨 Print</button>
    <div class="kpis">
      <div class="kpi"><div class="label">Total Revenue</div><div class="val">${rev}</div></div>
      <div class="kpi"><div class="label">Purchase Cost</div><div class="val">${cost}</div></div>
      <div class="kpi"><div class="label">Gross Profit</div><div class="val">${profit}</div></div>
      <div class="kpi"><div class="label">Net P&L</div><div class="val" style="color:${pl.startsWith("+")?"#27ae60":"#e74c3c"}">${pl}</div></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Product</th><th>Category</th><th>Qty</th><th>Purchase</th><th>Selling</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></body></html>`);
  win.document.close();
}

// ============================================
//  EXPOSE GLOBALS
// ============================================
window.isOwner          = isOwner;
window.applyRolePermissions = applyRolePermissions;
window.showSection      = showSection;
window.toggleSidebar    = toggleSidebar;
window.closeSidebar     = closeSidebar;
window.addProduct       = addProduct;
window.deleteProduct    = deleteProduct;
window.editProduct      = editProduct;
window.cancelEdit       = cancelEdit;
window.filterProducts   = filterProducts;
window.addSupplier      = addSupplier;
window.deleteSupplier   = deleteSupplier;
window.filterSuppliers  = filterSuppliers;
window.exportToExcel    = exportToExcel;
window.generateInvoice  = generateInvoice;
window.addBillRow       = addBillRow;
window.removeBillRow    = removeBillRow;
window.updateBillRow    = updateBillRow;
window.updateBillSummary= updateBillSummary;
window.clearBill        = clearBill;
window.finalizeBill     = finalizeBill;
window.searchBillProduct= searchBillProduct;
window.openProductDropdown=openProductDropdown;
window.selectBillProduct= selectBillProduct;
window.loadSales        = loadSales;
window.clearSalesFilter = clearSalesFilter;
window.filterSalesTable = filterSalesTable;
window.viewBillDetails  = viewBillDetails;
window.reprintBill      = reprintBill;
window.deleteSale       = deleteSale;
window.loadUsers        = loadUsers;
window.addUser          = addUser;
window.deleteUser       = deleteUser;
window.openAddUserModal = openAddUserModal;
window.loadReports      = loadReports;
window.filterReportTable= filterReportTable;
window.exportReportCSV  = exportReportCSV;
window.printReport      = printReport;