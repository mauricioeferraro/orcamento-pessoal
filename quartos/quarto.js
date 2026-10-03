(function () {
  const body = document.body;
  const ROOM = {
    fbUrl: "https://amar-care-default-rtdb.firebaseio.com/" + body.dataset.fb + ".json",
    storageKey: body.dataset.storage,
    barColor: body.dataset.bar || "#e88dad",
    sortPending: body.dataset.sort === "1",
    seed: JSON.parse(document.getElementById("seed").textContent)
  };

  let state = { budget: [], enxoval: [] };
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
    return { updatedAt: Date.now(), budget: state.budget, enxoval: state.enxoval };
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
    state = {
      budget: Array.isArray(remote.budget) ? remote.budget : [],
      enxoval: Array.isArray(remote.enxoval) ? remote.enxoval : []
    };
    lastWrite = doc.updatedAt || lastWrite;
    persistLocal(doc);
    render();
    applyingRemote = false;
    setCloudStatus("Atualizado", "ok");
  }

  async function pullFirebase() {
    if (pushTimer) return;
    if (document.activeElement && document.activeElement.isContentEditable) return;
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
      if (document.activeElement && document.activeElement.isContentEditable) {
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

  function budgetRow(row, index) {
    const done = row.status === "concluido";
    return `<tr data-kind="budget" data-index="${index}">
      <td contenteditable="true" data-field="desc" data-label="Descrição">${esc(row.desc)}</td>
      <td contenteditable="true" data-field="cost" data-label="Custo">${esc(row.cost)}</td>
      <td contenteditable="true" data-field="supplier" data-label="Fornecedor">${esc(row.supplier)}</td>
      <td class="col-notes" contenteditable="true" data-field="notes" data-label="Observações">${esc(row.notes)}</td>
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
    budgetBody.innerHTML = state.budget.map(budgetRow).join("") +
      `<tr class="total-row">
        <td data-label="Total">Orçamento total</td>
        <td id="totalSumCell" data-label="Soma"></td>
        <td></td>
        <td class="col-notes"></td>
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

  function fieldFromRow(kind, row, field) {
    if (kind === "budget") {
      if (field === "desc") return "desc";
      if (field === "cost") return "cost";
      if (field === "supplier") return "supplier";
      return "notes";
    }
    if (field === "item") return "item";
    if (field === "qty") return "qty";
    return "notes";
  }

  function onEdit(event) {
    const td = event.target.closest("td[data-field]");
    const tr = event.target.closest("tr[data-index]");
    if (!td || !tr) return;
    const kind = tr.dataset.kind;
    const index = Number(tr.dataset.index);
    const key = fieldFromRow(kind, state[kind][index], td.dataset.field);
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
      state.budget.push({ desc: "Novo item", cost: "R$ 0,00", supplier: "", notes: "", status: "pendente" });
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

  async function boot() {
    setCloudStatus("Carregando…");
    state = clone(ROOM.seed);
    try {
      const local = JSON.parse(localStorage.getItem(ROOM.storageKey) || "null");
      if (local && (Array.isArray(local.budget) || Array.isArray(local.enxoval))) {
        state = { budget: local.budget || [], enxoval: local.enxoval || [] };
      }
    } catch (error) {
      state = clone(ROOM.seed);
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
  document.getElementById("budgetTable").addEventListener("focusout", onCostBlur);
  document.getElementById("searchInput").addEventListener("input", applyFilter);
  document.body.addEventListener("click", onClick);
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!pendingRemote) return;
      if (document.activeElement && document.activeElement.isContentEditable) return;
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
