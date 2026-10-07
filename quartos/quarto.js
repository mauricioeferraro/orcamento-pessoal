(function () {
  const body = document.body;
  const ROOM = {
    fbUrl: "https://amar-care-default-rtdb.firebaseio.com/" + body.dataset.fb + ".json",
    storageKey: body.dataset.storage,
    barColor: body.dataset.bar || "#e88dad",
    sortPending: body.dataset.sort === "1",
    schedule: body.dataset.schedule === "1",
    seed: JSON.parse(document.getElementById("seed").textContent)
  };

  let state = { budget: [], enxoval: [], readyBy: "" };
  let pushTimer = null;
  let lastWrite = 0;
  let applyingRemote = false;
  let pendingRemote = null;
  let budgetChart = null;
  let progressChart = null;
  let chartTotal = 0;
  let usingCounts = false;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseCurrency(str) {
    if (str == null) return 0;
    const clean = String(str).replace(/R\$/gi, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "").trim();
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
  }

  function formatCurrency(num) {
    return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function setCloudStatus(text, kind) {
    const el = document.getElementById("cloudStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("ok", kind === "ok");
    el.classList.toggle("warn", kind === "warn");
  }

  function sortPending(list) {
    return list.filter((row) => row.status !== "concluido").concat(list.filter((row) => row.status === "concluido"));
  }

  function payload() {
    const doc = { updatedAt: Date.now(), budget: state.budget, enxoval: state.enxoval };
    if (ROOM.schedule) doc.readyBy = state.readyBy || "";
    return doc;
  }

  function readState(doc) {
    return {
      budget: Array.isArray(doc.budget) ? doc.budget : [],
      enxoval: Array.isArray(doc.enxoval) ? doc.enxoval : [],
      readyBy: typeof doc.readyBy === "string" ? doc.readyBy : ""
    };
  }

  function isEditing() {
    const el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    return !!(el.closest && el.closest("input, textarea, select"));
  }

  function persistLocal(doc) {
    localStorage.setItem(ROOM.storageKey, JSON.stringify(doc || payload()));
  }

  function unwrap(doc) {
    if (!doc || typeof doc !== "object") return null;
    if (Array.isArray(doc.budget) || Array.isArray(doc.enxoval)) return doc;
    return null;
  }

  function scheduleSave() {
    if (applyingRemote) return;
    persistLocal();
    setCloudStatus("Salvando…");
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushFirebase, 400);
  }

  async function pushFirebase() {
    pushTimer = null;
    const doc = payload();
    lastWrite = doc.updatedAt;
    persistLocal(doc);
    try {
      const response = await fetch(ROOM.fbUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc)
      });
      if (!response.ok) throw new Error(String(response.status));
      setCloudStatus("Salvo", "ok");
    } catch (error) {
      setCloudStatus("Sem conexão. Guardado neste celular.", "warn");
    }
  }

  function applyRemote(doc) {
    const remote = unwrap(doc);
    if (!remote) return;
    applyingRemote = true;
    state = readState(remote);
    lastWrite = doc.updatedAt || lastWrite;
    persistLocal(doc);
    render();
    applyingRemote = false;
    setCloudStatus("Atualizado", "ok");
  }

  async function pullFirebase() {
    if (pushTimer) return;
    if (isEditing()) return;
    try {
      const doc = await fetch(ROOM.fbUrl, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      });
      if (!doc || doc.updatedAt === lastWrite) return;
      applyRemote(doc);
    } catch (error) {
      /* mantém a cópia local */
    }
  }

  function listenFirebase() {
    const source = new EventSource(ROOM.fbUrl);
    source.addEventListener("put", (event) => {
      let payloadData;
      try { payloadData = JSON.parse(event.data); } catch (error) { return; }
      if (!payloadData || payloadData.path !== "/") {
        pullFirebase();
        return;
      }
      const doc = payloadData.data;
      if (!doc || doc.updatedAt === lastWrite || pushTimer) return;
      if (isEditing()) {
        pendingRemote = doc;
        return;
      }
      applyRemote(doc);
    });
    source.addEventListener("patch", () => pullFirebase());
    source.onerror = () => {
      source.close();
      setTimeout(listenFirebase, 5000);
    };
  }

  function scheduleInputs(row) {
    if (!ROOM.schedule) return "";
    return `<td data-label="Data de compra estimada"><input type="date" data-field="purchaseDate" value="${esc(row.purchaseDate || "")}" aria-label="Data de compra estimada"></td>
      <td data-label="Prazo de entrega"><input type="number" data-field="leadDays" min="0" step="1" inputmode="numeric" placeholder="dias" value="${esc(row.leadDays || "")}" aria-label="Prazo de entrega em dias"></td>`;
  }

  function budgetRow(row, index) {
    const done = row.status === "concluido";
    return `<tr data-kind="budget" data-index="${index}">
      <td contenteditable="true" data-field="desc" data-label="Descrição">${esc(row.desc)}</td>
      <td contenteditable="true" data-field="cost" data-label="Custo">${esc(row.cost)}</td>
      <td contenteditable="true" data-field="supplier" data-label="Fornecedor">${esc(row.supplier)}</td>
      <td class="col-notes" contenteditable="true" data-field="notes" data-label="Observações">${esc(row.notes)}</td>
      ${scheduleInputs(row)}
      <td data-label="Status"><button type="button" class="status-btn ${done ? "concluido" : "pendente"}" data-action="status">${done ? "Concluído" : "Pendente"}</button></td>
      <td data-label="Ações"><button type="button" class="delete-row-btn" data-action="delete" aria-label="Excluir linha">×</button></td>
    </tr>`;
  }

  function enxovalRow(row, index) {
    const done = row.status === "concluido";
    return `<tr data-kind="enxoval" data-index="${index}">
      <td contenteditable="true" data-field="item" data-label="Item">${esc(row.item)}</td>
      <td contenteditable="true" data-field="qty" data-label="Quantidade">${esc(row.qty)}</td>
      <td data-label="Status"><button type="button" class="status-btn ${done ? "concluido" : "pendente"}" data-action="status">${done ? "Concluído" : "Pendente"}</button></td>
      <td contenteditable="true" data-field="notes" data-label="Observações">${esc(row.notes)}</td>
      <td data-label="Ações"><button type="button" class="delete-row-btn" data-action="delete" aria-label="Excluir linha">×</button></td>
    </tr>`;
  }

  function render() {
    const budgetBody = document.getElementById("budgetBody");
    const enxovalBody = document.getElementById("enxovalBody");
    const scheduleGap = ROOM.schedule ? "<td></td><td></td>" : "";
    budgetBody.innerHTML = state.budget.map(budgetRow).join("") +
      `<tr class="total-row">
        <td data-label="Total">Orçamento total</td>
        <td id="totalSumCell" data-label="Soma"></td>
        <td></td>
        <td class="col-notes"></td>
        ${scheduleGap}
        <td></td>
        <td></td>
      </tr>`;
    enxovalBody.innerHTML = state.enxoval.map(enxovalRow).join("");
    applyFilter();
    refreshNumbers();
  }

  function stats() {
    let total = 0;
    let done = 0;
    let pending = 0;
    let doneCount = 0;
    let pendingCount = 0;
    const items = [];
    state.budget.forEach((row) => {
      const cost = parseCurrency(row.cost);
      total += cost;
      if (row.status === "concluido") {
        done += cost;
        doneCount += 1;
      } else {
        pending += cost;
        pendingCount += 1;
      }
      const desc = (row.desc || "").trim();
      if (desc) items.push({ desc, cost });
    });
    items.sort((a, b) => b.cost - a.cost);
    let enxovalDone = 0;
    state.enxoval.forEach((row) => {
      if (row.status === "concluido") enxovalDone += 1;
    });
    return { total, done, pending, doneCount, pendingCount, items, enxovalDone, enxovalPending: state.enxoval.length - enxovalDone };
  }

  function labelCount(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function refreshNumbers() {
    const info = stats();
    const totalCell = document.getElementById("totalSumCell");
    const kpiTotal = document.getElementById("kpiTotal");
    const kpiDone = document.getElementById("kpiConcluido");
    const kpiPending = document.getElementById("kpiPendente");
    const progress = document.getElementById("enxovalProgress");
    if (totalCell) totalCell.textContent = formatCurrency(info.total);
    if (kpiTotal) kpiTotal.textContent = formatCurrency(info.total);
    if (kpiDone) kpiDone.textContent = formatCurrency(info.done);
    if (kpiPending) kpiPending.textContent = formatCurrency(info.pending);
    if (progress) {
      progress.textContent = labelCount(info.enxovalDone, "concluído", "concluídos") + " · " + labelCount(info.enxovalPending, "pendente", "pendentes");
    }
    updateCharts(info);
    renderSchedule();
  }

  function barHeight(count) {
    const mobile = window.innerWidth < 760;
    const rows = Math.max(count, 4);
    return Math.min(mobile ? 460 : 680, Math.max(mobile ? 240 : 360, rows * (mobile ? 34 : 30)));
  }

  function ensureCharts() {
    if (typeof Chart === "undefined") return;
    if (!progressChart) {
      progressChart = new Chart(document.getElementById("progressChart"), {
        type: "doughnut",
        data: {
          labels: ["Concluído", "Pendente"],
          datasets: [{
            data: [0, 0],
            backgroundColor: ["#a5d6a7", "#ffb74d"],
            borderWidth: 2,
            borderColor: "#ffffff"
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "62%",
          plugins: {
            legend: { position: "bottom", labels: { font: { family: "Poppins", size: 12 }, boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: function (context) {
                  if (usingCounts) return " " + context.label + ": " + context.raw + " itens";
                  const total = chartTotal || 0;
                  const pct = total > 0 ? ((context.raw / total) * 100).toFixed(1) : 0;
                  return " " + context.label + ": " + formatCurrency(context.raw) + " (" + pct + "%)";
                }
              }
            }
          }
        }
      });
    }
    if (!budgetChart) {
      const percentageLabels = {
        id: "percentageLabels",
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          chart.data.datasets.forEach((dataset, i) => {
            const meta = chart.getDatasetMeta(i);
            meta.data.forEach((bar, index) => {
              const value = dataset.data[index];
              if (chartTotal > 0 && value > 0) {
                ctx.save();
                ctx.font = "bold 11px Poppins, sans-serif";
                ctx.fillStyle = "#666";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(((value / chartTotal) * 100).toFixed(1) + "%", bar.x + 8, bar.y);
                ctx.restore();
              }
            });
          });
        }
      };
      budgetChart = new Chart(document.getElementById("budgetChart"), {
        type: "bar",
        data: {
          labels: [],
          datasets: [{ label: "Custo (R$)", data: [], backgroundColor: ROOM.barColor, borderRadius: 4 }]
        },
        plugins: [percentageLabels],
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 48 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const pct = chartTotal > 0 ? ((context.raw / chartTotal) * 100).toFixed(1) : 0;
                  return " Custo: " + formatCurrency(context.raw) + " (" + pct + "% do total)";
                }
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              ticks: { callback: (value) => "R$ " + Number(value).toLocaleString("pt-BR") }
            },
            y: { ticks: { font: { size: 11, weight: "500" } } }
          }
        }
      });
    }
  }

  function updateCharts(info) {
    const box = document.querySelector(".chart-container-large");
    if (box) box.style.height = barHeight(info.items.length) + "px";
    ensureCharts();
    if (!budgetChart || !progressChart) return;
    chartTotal = info.total;
    usingCounts = info.total <= 0;
    budgetChart.data.labels = info.items.map((item) => item.desc);
    budgetChart.data.datasets[0].data = info.items.map((item) => item.cost);
    budgetChart.update("none");
    progressChart.data.datasets[0].data = usingCounts
      ? [info.doneCount, info.pendingCount]
      : [info.done, info.pending];
    progressChart.update("none");
    requestAnimationFrame(() => {
      budgetChart.resize();
      progressChart.resize();
    });
  }

  function fieldFromRow(kind, field) {
    const budgetFields = { desc: "desc", cost: "cost", supplier: "supplier", notes: "notes", leadDays: "leadDays", purchaseDate: "purchaseDate" };
    const enxovalFields = { item: "item", qty: "qty", notes: "notes" };
    const map = kind === "budget" ? budgetFields : enxovalFields;
    return map[field] || null;
  }

  function onEdit(event) {
    const input = event.target.closest("input[data-field]");
    if (input) {
      updateScheduleInput(input);
      return;
    }
    const td = event.target.closest("td[data-field]");
    const tr = event.target.closest("tr[data-index]");
    if (!td || !tr) return;
    const kind = tr.dataset.kind;
    const index = Number(tr.dataset.index);
    const key = fieldFromRow(kind, td.dataset.field);
    if (!key || !state[kind][index]) return;
    state[kind][index][key] = td.textContent;
    refreshNumbers();
    scheduleSave();
  }

  function onCostBlur(event) {
    const td = event.target.closest("td[data-field='cost']");
    const tr = event.target.closest("tr[data-index]");
    if (!td || !tr) return;
    const index = Number(tr.dataset.index);
    const formatted = formatCurrency(parseCurrency(td.textContent));
    state.budget[index].cost = formatted;
    td.textContent = formatted;
    refreshNumbers();
    scheduleSave();
  }

  function focusNew(kind, index) {
    const field = kind === "budget" ? "desc" : "item";
    const cell = document.querySelector(`tr[data-kind="${kind}"][data-index="${index}"] td[data-field="${field}"]`);
    if (!cell) return;
    cell.focus();
    const range = document.createRange();
    range.selectNodeContents(cell);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    cell.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function addRow(kind) {
    if (kind === "budget") {
      const row = { desc: "Novo item", cost: "R$ 0,00", supplier: "", notes: "", status: "pendente" };
      if (ROOM.schedule) {
        row.purchaseDate = "";
        row.leadDays = "";
      }
      state.budget.push(row);
      if (ROOM.sortPending) state.budget = sortPending(state.budget);
    } else {
      state.enxoval.push({ item: "Novo item", qty: "1", notes: "", status: "pendente" });
      if (ROOM.sortPending) state.enxoval = sortPending(state.enxoval);
    }
    const list = state[kind];
    let index = list.length - 1;
    const nameOf = (row) => kind === "budget" ? row.desc : row.item;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (nameOf(list[i]) === "Novo item") { index = i; break; }
    }
    render();
    focusNew(kind, index);
    scheduleSave();
  }

  function toggleStatus(tr) {
    const kind = tr.dataset.kind;
    const index = Number(tr.dataset.index);
    const row = state[kind][index];
    row.status = row.status === "concluido" ? "pendente" : "concluido";
    if (ROOM.sortPending) state[kind] = sortPending(state[kind]);
    render();
    scheduleSave();
  }

  function deleteRow(tr) {
    const kind = tr.dataset.kind;
    state[kind].splice(Number(tr.dataset.index), 1);
    render();
    scheduleSave();
  }

  function switchTab(tabId) {
    document.querySelectorAll(".tab-content").forEach((el) => el.classList.toggle("active", el.id === tabId));
    document.querySelectorAll(".tab-btn").forEach((el) => el.classList.toggle("active", el.dataset.tab === tabId));
    if (tabId === "orcamento") refreshNumbers();
  }

  function applyFilter() {
    const input = document.getElementById("searchInput");
    const filter = (input && input.value || "").toLowerCase();
    document.querySelectorAll("#enxovalBody tr").forEach((tr) => {
      const cell = tr.querySelector("[data-field='item']");
      const text = cell ? cell.textContent.toLowerCase() : "";
      tr.style.display = text.indexOf(filter) > -1 ? "" : "none";
    });
  }

  function onClick(event) {
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      switchTab(tab.dataset.tab);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "add-budget") addRow("budget");
    if (action.dataset.action === "add-enxoval") addRow("enxoval");
    if (action.dataset.action === "status") toggleStatus(action.closest("tr"));
    if (action.dataset.action === "delete") deleteRow(action.closest("tr"));
  }

  function parseLead(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (text === "") return null;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n);
  }

  function parseISODate(iso) {
    const parts = String(iso || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !n)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function shiftDays(iso, days) {
    const date = parseISODate(iso);
    if (!date) return "";
    date.setDate(date.getDate() + days);
    return toISODate(date);
  }

  function daysBetween(fromIso, toIso) {
    const from = parseISODate(fromIso);
    const to = parseISODate(toIso);
    if (!from || !to) return null;
    return Math.round((to - from) / 86400000);
  }

  function todayISO() {
    const now = new Date();
    return toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  function formatDateBR(iso) {
    const date = parseISODate(iso);
    if (!date) return "";
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return d + "/" + m + "/" + date.getFullYear();
  }

  function dayLabel(n) {
    const abs = Math.abs(n);
    return abs + (abs === 1 ? " dia" : " dias");
  }

  function syncReadyByInput() {
    const input = document.getElementById("readyByInput");
    if (!input || document.activeElement === input) return;
    input.value = state.readyBy || "";
  }

  function updateScheduleInput(input) {
    const tr = input.closest("tr[data-index]");
    if (!tr || tr.dataset.kind !== "budget") return;
    const index = Number(tr.dataset.index);
    const row = state.budget[index];
    if (!row) return;
    if (input.dataset.field === "leadDays") row.leadDays = input.value;
    else if (input.dataset.field === "purchaseDate") row.purchaseDate = input.value;
    else return;
    document.querySelectorAll('tr[data-kind="budget"][data-index="' + index + '"] input[data-field="' + input.dataset.field + '"]').forEach((other) => {
      if (other !== input) other.value = input.value;
    });
    renderSchedule();
    scheduleSave();
  }

  function describeSituation(entry) {
    if (entry.row.status === "concluido") return { kind: "done", label: "Concluído" };
    if (!entry.ready) return { kind: "missing", label: "Defina a data limite" };
    if (entry.lead == null) return { kind: "missing", label: "Informe o prazo" };
    if (entry.daysLeft < 0) return { kind: "late", label: "Atrasado há " + dayLabel(entry.daysLeft) };
    if (entry.planLate) return { kind: "plan-late", label: "Compra estimada não chega a tempo" };
    if (entry.daysLeft === 0) return { kind: "soon", label: "Comprar hoje" };
    if (entry.daysLeft <= 14) return { kind: "soon", label: "Faltam " + dayLabel(entry.daysLeft) };
    if (entry.purchase) return { kind: "ok", label: "Chega a tempo" };
    return { kind: "ok", label: "No prazo" };
  }

  function scheduleEntries() {
    const today = todayISO();
    const ready = parseISODate(state.readyBy) ? state.readyBy : "";
    const kindOrder = { late: 0, "plan-late": 1, soon: 2, ok: 3, missing: 4, done: 5 };
    return state.budget.map((row, index) => {
      const lead = parseLead(row.leadDays);
      const purchase = parseISODate(row.purchaseDate) ? row.purchaseDate : "";
      const maxBuy = ready && lead != null ? shiftDays(ready, -lead) : "";
      const arrival = purchase && lead != null ? shiftDays(purchase, lead) : "";
      const daysLeft = maxBuy ? daysBetween(today, maxBuy) : null;
      const planLate = !!(purchase && maxBuy && purchase > maxBuy);
      const entry = { row, index, lead, purchase, ready, maxBuy, arrival, daysLeft, planLate };
      entry.situation = describeSituation(entry);
      return entry;
    }).sort((a, b) => {
      const rank = kindOrder[a.situation.kind] - kindOrder[b.situation.kind];
      if (rank) return rank;
      if (a.maxBuy && b.maxBuy && a.maxBuy !== b.maxBuy) return a.maxBuy < b.maxBuy ? -1 : 1;
      return (a.row.desc || "").localeCompare(b.row.desc || "", "pt-BR");
    });
  }

  function scheduleRowHtml(entry) {
    const name = (entry.row.desc || "").trim() || "(sem descrição)";
    const supplier = (entry.row.supplier || "").trim();
    const leadValue = entry.row.leadDays == null ? "" : entry.row.leadDays;
    return `<tr class="schedule-${esc(entry.situation.kind)}" data-kind="budget" data-index="${entry.index}">
      <td data-label="Item"><div class="schedule-item">${esc(name)}</div>${supplier ? `<div class="schedule-supplier">${esc(supplier)}</div>` : ""}</td>
      <td data-label="Prazo de entrega"><input type="number" data-field="leadDays" min="0" step="1" inputmode="numeric" placeholder="dias" value="${esc(leadValue)}" aria-label="Prazo de entrega em dias"></td>
      <td data-label="Data de compra estimada"><input type="date" data-field="purchaseDate" value="${esc(entry.purchase)}" aria-label="Data de compra estimada"></td>
      <td class="col-deadline" data-label="Comprar no máximo" data-computed="maxBuy">${entry.maxBuy ? esc(formatDateBR(entry.maxBuy)) : "—"}</td>
      <td data-label="Chegada estimada" data-computed="arrival">${entry.arrival ? esc(formatDateBR(entry.arrival)) : "—"}</td>
      <td data-label="Situação" data-computed="situation"><span class="badge ${esc(entry.situation.kind)}">${esc(entry.situation.label)}</span></td>
    </tr>`;
  }

  function fillScheduleComputed(tr) {
    const index = Number(tr.dataset.index);
    const entry = scheduleEntries().find((item) => item.index === index);
    if (!entry) return;
    tr.className = "schedule-" + entry.situation.kind;
    const maxCell = tr.querySelector('[data-computed="maxBuy"]');
    const arrivalCell = tr.querySelector('[data-computed="arrival"]');
    const situationCell = tr.querySelector('[data-computed="situation"]');
    if (maxCell) maxCell.textContent = entry.maxBuy ? formatDateBR(entry.maxBuy) : "—";
    if (arrivalCell) arrivalCell.textContent = entry.arrival ? formatDateBR(entry.arrival) : "—";
    if (situationCell) situationCell.innerHTML = `<span class="badge ${esc(entry.situation.kind)}">${esc(entry.situation.label)}</span>`;
  }

  function renderScheduleKpis() {
    const box = document.getElementById("scheduleKpis");
    if (!box) return;
    const open = scheduleEntries().filter((entry) => entry.row.status !== "concluido");
    const urgent = open.filter((entry) => entry.maxBuy).slice().sort((a, b) => a.maxBuy < b.maxBuy ? -1 : 1)[0];
    const attention = open.filter((entry) => entry.situation.kind === "late" || entry.situation.kind === "plan-late").length;
    const missing = open.filter((entry) => entry.situation.kind === "missing").length;
    const first = urgent
      ? `<span class="kpi-value schedule-kpi-name">${esc((urgent.row.desc || "").trim() || "(sem descrição)")}</span><span class="kpi-sub">comprar até ${esc(formatDateBR(urgent.maxBuy))}</span>`
      : `<span class="kpi-value schedule-kpi-name">—</span><span class="kpi-sub">${state.readyBy ? "Informe o prazo dos itens" : "Defina até quando precisa chegar"}</span>`;
    box.innerHTML = `
      <div class="kpi-card"><span class="kpi-title">Comprar primeiro</span>${first}</div>
      <div class="kpi-card"><span class="kpi-title">Fora do prazo</span><span class="kpi-value kpi-alert">${attention}</span></div>
      <div class="kpi-card"><span class="kpi-title">Sem prazo</span><span class="kpi-value">${missing}</span></div>
    `;
  }

  function renderSchedule(force) {
    const bodyEl = document.getElementById("scheduleBody");
    if (!bodyEl || !ROOM.schedule) return;
    syncReadyByInput();
    const editing = bodyEl.contains(document.activeElement);
    if (editing && !force) {
      const tr = document.activeElement.closest("tr");
      if (tr) fillScheduleComputed(tr);
      renderScheduleKpis();
      return;
    }
    const entries = scheduleEntries();
    bodyEl.innerHTML = entries.length
      ? entries.map(scheduleRowHtml).join("")
      : `<tr><td colspan="6">Nenhum item no orçamento.</td></tr>`;
    renderScheduleKpis();
  }

  async function boot() {
    setCloudStatus("Carregando…");
    state = readState(clone(ROOM.seed));
    try {
      const local = JSON.parse(localStorage.getItem(ROOM.storageKey) || "null");
      if (local && (Array.isArray(local.budget) || Array.isArray(local.enxoval))) {
        state = readState(local);
      }
    } catch (error) {
      state = readState(clone(ROOM.seed));
    }
    render();
    try {
      const doc = await fetch(ROOM.fbUrl, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      });
      if (unwrap(doc)) {
        applyRemote(doc);
        setCloudStatus("Ligado", "ok");
      } else {
        scheduleSave();
      }
      listenFirebase();
    } catch (error) {
      setCloudStatus("Sem conexão. Mostrando a cópia deste celular.", "warn");
    }
  }

  document.getElementById("budgetTable").addEventListener("input", onEdit);
  document.getElementById("enxovalTable").addEventListener("input", onEdit);
  const scheduleTable = document.getElementById("scheduleTable");
  if (scheduleTable) {
    scheduleTable.addEventListener("input", (event) => {
      const input = event.target.closest("input[data-field]");
      if (input) updateScheduleInput(input);
    });
    scheduleTable.addEventListener("change", () => renderSchedule(true));
  }
  const readyInput = document.getElementById("readyByInput");
  if (readyInput) {
    readyInput.addEventListener("input", () => {
      state.readyBy = readyInput.value;
      renderSchedule(true);
      scheduleSave();
    });
  }
  document.getElementById("budgetTable").addEventListener("focusout", onCostBlur);
  document.getElementById("searchInput").addEventListener("input", applyFilter);
  document.body.addEventListener("click", onClick);
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!pendingRemote) return;
      if (isEditing()) return;
      const doc = pendingRemote;
      pendingRemote = null;
      applyRemote(doc);
    }, 250);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pullFirebase();
  });
  window.addEventListener("resize", () => refreshNumbers());
  boot();
})();
