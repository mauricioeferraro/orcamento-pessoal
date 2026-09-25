const FB_URL = "https://amar-care-default-rtdb.firebaseio.com/orcamento_pessoal.json";
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const state = {
  doc: null,
  month: null,
  view: "month",
  dirty: false,
  timer: null,
  source: null,
  lastWrite: 0,
};

const main = document.getElementById("main");
const monthsEl = document.getElementById("months");
const syncEl = document.getElementById("sync");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function monthLabel(key) {
  const [year, month] = key.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

function parseMoney(value) {
  const text = String(value).trim().replace(/\s/g, "").replace("R$", "");
  if (!text) return 0;
  if (text.includes(",") && text.includes(".")) return Number(text.replace(/\./g, "").replace(",", ".")) || 0;
  if (text.includes(",")) return Number(text.replace(",", ".")) || 0;
  return Number(text) || 0;
}

function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.data && typeof raw.data === "object") return { updatedAt: raw.updatedAt || 0, data: raw.data };
  const keys = Object.keys(raw);
  if (keys.length && keys.every((key) => /^\d{4}-\d{2}$/.test(key))) return { updatedAt: 0, data: raw };
  return null;
}

function sortedMonths() {
  return Object.keys(state.doc.data).sort();
}

function totals(bucket) {
  const income = (bucket.incomes || []).reduce((sum, item) => sum + Number(item.val || 0), 0);
  const fields = (bucket.categories || []).flatMap((category) => category.fields || []);
  const expense = fields.reduce((sum, item) => sum + Number(item.val || 0), 0);
  const pending = fields.filter((item) => item.status !== "pago").reduce((sum, item) => sum + Number(item.val || 0), 0);
  return { income, expense, pending, balance: income - expense };
}

function setSync(text, kind) {
  syncEl.textContent = text;
  syncEl.className = `sync${kind ? ` is-${kind}` : ""}`;
}

function current() {
  return state.doc.data[state.month];
}

function scheduleSave() {
  state.dirty = true;
  setSync("Salvando…");
  clearTimeout(state.timer);
  state.timer = setTimeout(save, 500);
}

async function save() {
  state.doc.updatedAt = Date.now();
  state.lastWrite = state.doc.updatedAt;
  localStorage.setItem("orcamento-pessoal", JSON.stringify(state.doc));
  try {
    const response = await fetch(FB_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.doc),
    });
    if (!response.ok) throw new Error(String(response.status));
    state.dirty = false;
    setSync("Salvo no Firebase", "live");
  } catch (error) {
    state.dirty = false;
    setSync("Guardado neste navegador", "error");
  }
}

function renderMonths() {
  monthsEl.innerHTML = sortedMonths().map((key) => (
    `<button type="button" data-action="set-month" data-month="${key}" class="${key === state.month ? "is-on" : ""}">${monthLabel(key)}</button>`
  )).join("") + `<button type="button" class="ghost" data-action="add-month">+ mês</button>`;
  document.querySelectorAll("[data-action='set-view']").forEach((button) => {
    button.classList.toggle("is-on", button.dataset.view === state.view);
  });
}

function statCard(label, value, kind) {
  return `<article class="stat ${kind || ""}"><span>${label}</span><strong>${money.format(value)}</strong></article>`;
}

function shareBar(bucket) {
  const pieces = (bucket.categories || []).map((category) => ({
    color: category.color || "#0f6e56",
    value: (category.fields || []).reduce((sum, item) => sum + Number(item.val || 0), 0),
  })).filter((piece) => piece.value > 0);
  const total = pieces.reduce((sum, piece) => sum + piece.value, 0) || 1;
  return `<div class="share">${pieces.map((piece) => `<i style="width:${(piece.value / total) * 100}%;background:${esc(piece.color)}"></i>`).join("")}</div>`;
}

function fieldRow(categoryIndex, index, field) {
  const max = Number(field.max || 0);
  const value = Number(field.val || 0);
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const paid = field.status === "pago";
  return `<div class="row" data-c="${categoryIndex}" data-i="${index}">
    <input class="desc" type="text" data-bind="field-label" value="${esc(field.label)}">
    <input class="parcela" type="text" data-bind="field-parcela" value="${esc(field.parcela || "-")}" aria-label="Parcela">
    <input class="money" type="text" inputmode="decimal" data-bind="field-val" value="${esc(field.val)}">
    <button type="button" class="status ${paid ? "is-paid" : ""}" data-action="toggle-status">${paid ? "Pago" : "Pendente"}</button>
    <button type="button" class="icon" data-action="remove-field" aria-label="Remover">×</button>
    <div class="bar ${max > 0 && value > max ? "is-over" : ""}"><span style="width:${width}%"></span></div>
  </div>`;
}

function renderMonth() {
  const bucket = current();
  const sum = totals(bucket);
  const incomes = (bucket.incomes || []).map((item, index) => `<div class="row" data-i="${index}">
    <input class="desc" type="text" data-bind="income-desc" value="${esc(item.desc)}">
    <input class="parcela" type="text" data-bind="income-parcela" value="${esc(item.parcela || "-")}" aria-label="Parcela">
    <input class="money" type="text" inputmode="decimal" data-bind="income-val" value="${esc(item.val)}">
    <span></span>
    <button type="button" class="icon" data-action="remove-income" aria-label="Remover">×</button>
  </div>`).join("");
  const categories = (bucket.categories || []).map((category, categoryIndex) => {
    const categoryTotal = (category.fields || []).reduce((sum, item) => sum + Number(item.val || 0), 0);
    return `<section class="card">
      <h2><span class="cat-head"><i class="dot" style="background:${esc(category.color)}"></i>${esc(category.label)}</span><em>${money.format(categoryTotal)}</em></h2>
      ${(category.fields || []).map((field, index) => fieldRow(categoryIndex, index, field)).join("") || `<p class="empty">Nenhuma despesa</p>`}
      <button type="button" class="add" data-action="add-field" data-c="${categoryIndex}">Adicionar despesa</button>
    </section>`;
  }).join("");

  main.innerHTML = `
    <section class="stats">
      ${statCard("Receitas", sum.income)}
      ${statCard("Despesas", sum.expense)}
      ${statCard("Saldo", sum.balance, sum.balance >= 0 ? "is-good" : "is-bad")}
      ${statCard("Pendente", sum.pending)}
    </section>
    ${shareBar(bucket)}
    <div class="layout">
      <section class="card">
        <h2>Receitas <em>${money.format(sum.income)}</em></h2>
        ${incomes || `<p class="empty">Nenhuma receita</p>`}
        <button type="button" class="add" data-action="add-income">Adicionar receita</button>
      </section>
      <div>
        ${categories}
        <button type="button" class="ghost" data-action="add-category">Nova categoria</button>
      </div>
    </div>`;
}

function renderYear() {
  const rows = sortedMonths().map((key) => {
    const sum = totals(state.doc.data[key]);
    return { key, ...sum };
  });
  const maxExpense = Math.max(...rows.map((row) => row.expense), 1);
  main.innerHTML = `<section class="card"><table class="year-table">
    <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo</th><th>Pendente</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td>${monthLabel(row.key)}<div class="year-bar"><span style="width:${(row.expense / maxExpense) * 100}%"></span></div></td>
      <td>${money.format(row.income)}</td>
      <td>${money.format(row.expense)}</td>
      <td>${money.format(row.balance)}</td>
      <td>${money.format(row.pending)}</td>
    </tr>`).join("")}</tbody>
  </table></section>`;
}

function render() {
  if (!state.doc) return;
  if (!state.doc.data[state.month]) state.month = sortedMonths()[0];
  renderMonths();
  if (state.view === "year") renderYear();
  else renderMonth();
}

function applyDoc(doc) {
  state.doc = doc;
  if (!state.month || !doc.data[state.month]) state.month = sortedMonths()[0];
  render();
}

function rowOf(target) {
  return target.closest(".row");
}

function onInput(event) {
  const input = event.target;
  const bind = input.dataset.bind;
  if (!bind) return;
  const row = rowOf(input);
  const index = Number(row.dataset.i);
  const bucket = current();
  if (bind.startsWith("income")) {
    const item = bucket.incomes[index];
    if (bind === "income-desc") item.desc = input.value;
    if (bind === "income-parcela") item.parcela = input.value;
    if (bind === "income-val") item.val = parseMoney(input.value);
  } else {
    const field = bucket.categories[Number(row.dataset.c)].fields[index];
    if (bind === "field-label") field.label = input.value;
    if (bind === "field-parcela") field.parcela = input.value;
    if (bind === "field-val") field.val = parseMoney(input.value);
  }
  scheduleSave();
  if (bind.endsWith("val")) refreshNumbers();
}

function refreshNumbers() {
  const bucket = current();
  const sum = totals(bucket);
  const cards = main.querySelectorAll(".stat strong");
  if (cards.length === 4) {
    cards[0].textContent = money.format(sum.income);
    cards[1].textContent = money.format(sum.expense);
    cards[2].textContent = money.format(sum.balance);
    cards[3].textContent = money.format(sum.pending);
    cards[2].parentElement.classList.toggle("is-good", sum.balance >= 0);
    cards[2].parentElement.classList.toggle("is-bad", sum.balance < 0);
  }
  const incomeTitle = main.querySelector(".layout .card h2 em");
  if (incomeTitle) incomeTitle.textContent = money.format(sum.income);
}

function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const bucket = current();
  if (action === "set-month") {
    state.month = button.dataset.month;
    state.view = "month";
    render();
  }
  if (action === "set-view") {
    state.view = button.dataset.view;
    render();
  }
  if (action === "add-month") {
    const key = prompt("Mês no formato AAAA-MM", "2027-01");
    if (!key || !/^\d{4}-\d{2}$/.test(key)) return;
    const copy = JSON.parse(JSON.stringify(bucket));
    (copy.categories || []).forEach((category) => (category.fields || []).forEach((field) => { field.status = "pendente"; }));
    state.doc.data[key] = copy;
    state.month = key;
    scheduleSave();
    render();
  }
  if (action === "add-income") {
    bucket.incomes.push({ desc: "Nova receita", val: 0, parcela: "-" });
    scheduleSave();
    render();
  }
  if (action === "remove-income") {
    bucket.incomes.splice(Number(rowOf(button).dataset.i), 1);
    scheduleSave();
    render();
  }
  if (action === "add-field") {
    bucket.categories[Number(button.dataset.c)].fields.push({ label: "Nova despesa", val: 0, max: 0, status: "pendente", parcela: "-" });
    scheduleSave();
    render();
  }
  if (action === "remove-field") {
    const row = rowOf(button);
    bucket.categories[Number(row.dataset.c)].fields.splice(Number(row.dataset.i), 1);
    scheduleSave();
    render();
  }
  if (action === "toggle-status") {
    const row = rowOf(button);
    const field = bucket.categories[Number(row.dataset.c)].fields[Number(row.dataset.i)];
    field.status = field.status === "pago" ? "pendente" : "pago";
    scheduleSave();
    render();
  }
  if (action === "add-category") {
    const label = prompt("Nome da categoria");
    if (!label) return;
    bucket.categories.push({ key: `custom_${Date.now()}`, label, color: "#0f6e56", fields: [] });
    scheduleSave();
    render();
  }
}

function listen() {
  if (state.source) state.source.close();
  const source = new EventSource(FB_URL);
  state.source = source;
  source.addEventListener("put", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.path !== "/") return;
    const doc = normalize(payload.data);
    if (!doc || doc.updatedAt === state.lastWrite || state.dirty) return;
    applyDoc(doc);
    setSync("Atualizado pelo Firebase", "live");
  });
  source.onerror = () => {
    source.close();
    if (!syncEl.classList.contains("is-live")) setSync("Firebase sem leitura pública", "error");
  };
}

async function init() {
  const bundled = await fetch("data/orcamento.json").then((response) => response.json());
  let doc = normalize(bundled);
  const cached = normalize(JSON.parse(localStorage.getItem("orcamento-pessoal") || "null"));
  if (cached && cached.updatedAt >= doc.updatedAt) doc = cached;
  applyDoc(doc);
  setSync("Cópia local");
  try {
    const remoteRaw = await fetch(FB_URL).then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    });
    const remote = normalize(remoteRaw);
    if (remote && remote.updatedAt >= doc.updatedAt) applyDoc(remote);
    else if (!remote) await save();
    setSync("Ligado ao Firebase", "live");
    listen();
  } catch (error) {
    setSync("Firebase sem permissão de leitura", "error");
  }
}

document.body.addEventListener("input", onInput);
document.body.addEventListener("click", onClick);
init();
