const state = { reminders: [], filter: "all", search: "", editingId: null };
const elements = {
  form: document.querySelector("#reminder-form"),
  content: document.querySelector("#content"),
  localTime: document.querySelector("#local-time"),
  timeZone: document.querySelector("#time-zone"),
  feedback: document.querySelector("#form-feedback"),
  list: document.querySelector("#reminder-list"),
  search: document.querySelector("#search"),
  lastSynced: document.querySelector("#last-synced"),
  allCount: document.querySelector("#all-count"),
  scheduledCount: document.querySelector("#scheduled-count"),
  deliveredCount: document.querySelector("#delivered-count"),
  refresh: document.querySelector("#refresh-button"),
  connectionLabel: document.querySelector("#connection-label"),
  statusDot: document.querySelector("#status-dot"),
  dialog: document.querySelector("#edit-dialog"),
  editForm: document.querySelector("#edit-form"),
  editId: document.querySelector("#edit-id"),
  editContent: document.querySelector("#edit-content"),
  editTime: document.querySelector("#edit-time"),
  editZone: document.querySelector("#edit-zone"),
  toast: document.querySelector("#toast"),
};

const formatDate = (value, timeZone) => {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value));
  } catch {
    return value;
  }
};
const formatLocalInput = (value) => (value ? value.slice(0, 16) : "");
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
const labelFor = (stateName) =>
  ({
    scheduled: "Scheduled",
    delivered: "Delivered",
    cancelled: "Cancelled",
    failed: "Failed",
  })[stateName] || stateName;

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || "The request could not be completed.");
  return body;
}

function setConnection(connected, message = connected ? "Worker online" : "Connection lost") {
  elements.connectionLabel.textContent = message;
  elements.statusDot.classList.toggle("offline", !connected);
}

function showConnectionError() {
  elements.list.innerHTML = '<div class="empty-state"><strong>Could not reach the reminder service</strong><p>Check that the server is running, then try again.</p><button class="retry-button" type="button" data-action="retry">Retry connection</button></div>';
}

async function loadReminders({ quiet = false } = {}) {
  if (!quiet && state.reminders.length === 0)
    elements.list.innerHTML =
      '<div class="loading">Loading reminder ledger...</div>';
  try {
    const [reminders, health] = await Promise.all([
      request("/api/reminders"),
      request("/api/health"),
    ]);
    state.reminders = reminders;
    setConnection(health.workerRunning, health.workerRunning ? "Worker online" : "Worker stopped");
    render();
    elements.lastSynced.textContent = `Synced ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    showConnectionError();
    setConnection(false);
    elements.lastSynced.textContent = "Sync failed";
  }
}

function render() {
  const query = state.search.toLowerCase();
  const filtered = state.reminders
    .filter((reminder) => {
      const matchesFilter =
        state.filter === "all" || reminder.state === state.filter;
      const matchesSearch =
        !query ||
        reminder.content.toLowerCase().includes(query) ||
        reminder.timeZone.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    })
    .sort((a, b) => new Date(a.nextAttemptAt) - new Date(b.nextAttemptAt));
  const counts = state.reminders.reduce((result, reminder) => {
    result[reminder.state] = (result[reminder.state] || 0) + 1;
    return result;
  }, {});
  elements.allCount.textContent = state.reminders.length;
  elements.scheduledCount.textContent = counts.scheduled || 0;
  elements.deliveredCount.textContent = counts.delivered || 0;
  if (!filtered.length) {
    elements.list.innerHTML = `<div class="empty-state"><strong>${state.reminders.length ? "No matching reminders" : "Your ledger is empty"}</strong><p>${state.reminders.length ? "Try a different search or filter." : "Create your first durable reminder to get started."}</p></div>`;
    return;
  }
  elements.list.innerHTML = filtered
    .map(
      (reminder) => `
    <article class="reminder-card">
      <div class="reminder-main"><h3 class="reminder-title">${escapeHtml(reminder.content)}</h3><div class="reminder-meta"><span class="date">${formatDate(reminder.dueAt, reminder.timeZone)}</span><span>${escapeHtml(reminder.timeZone)}</span><span>v${reminder.version}</span>${reminder.attempts.length ? `<span>${reminder.attempts.length} attempt${reminder.attempts.length === 1 ? "" : "s"}</span>` : ""}</div></div>
      <div class="reminder-side"><span class="badge ${escapeHtml(reminder.state)}">${labelFor(reminder.state)}</span>${["scheduled", "running"].includes(reminder.state) ? `<button class="row-action" type="button" data-action="edit" data-id="${reminder.id}">Edit</button><button class="row-action danger" type="button" data-action="cancel" data-id="${reminder.id}">Cancel</button>` : ""}</div>
    </article>`,
    )
    .join("");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(
    () => elements.toast.classList.remove("show"),
    2800,
  );
}
function setFeedback(message = "") {
  elements.feedback.textContent = message;
}
function setDefaultTime() {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  elements.localTime.value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}T${String(next.getHours()).padStart(2, "0")}:00`;
}

async function createReminder(event) {
  event.preventDefault();
  setFeedback("");
  const submitButton = elements.form.querySelector("button[type=submit]");
  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Saving...";
  try {
    await request("/api/reminders", {
      method: "POST",
      body: JSON.stringify({
        content: elements.content.value.trim(),
        localTime: elements.localTime.value,
        timeZone: elements.timeZone.value,
      }),
    });
    elements.form.reset();
    setDefaultTime();
    showToast("Reminder added to the ledger");
    await loadReminders({ quiet: true });
  } catch (error) {
    setFeedback(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Create reminder";
  }
}

function openEditor(id) {
  const reminder = state.reminders.find((item) => item.id === id);
  if (!reminder) return;
  state.editingId = id;
  elements.editId.value = id;
  elements.editContent.value = reminder.content;
  elements.editTime.value = formatLocalInput(reminder.localTime);
  elements.editZone.value = reminder.timeZone;
  elements.dialog.showModal();
}
async function saveEdit(event) {
  event.preventDefault();
  try {
    await request(`/api/reminders/${state.editingId}`, {
      method: "PATCH",
      body: JSON.stringify({
        content: elements.editContent.value.trim(),
        localTime: elements.editTime.value,
        timeZone: elements.editZone.value,
      }),
    });
    elements.dialog.close();
    showToast("New reminder version saved");
    await loadReminders({ quiet: true });
  } catch (error) {
    showToast(error.message);
  }
}
async function cancelReminder(id) {
  if (!window.confirm("Cancel this reminder? This cannot be undone.")) return;
  try {
    await request(`/api/reminders/${id}/cancel`, { method: "POST" });
    showToast("Reminder cancelled");
    await loadReminders({ quiet: true });
  } catch (error) {
    showToast(error.message);
  }
}

elements.form.addEventListener("submit", createReminder);
elements.editForm.addEventListener("submit", saveEdit);
elements.search.addEventListener("input", (event) => {
  state.search = event.target.value;
  render();
});
elements.refresh.addEventListener("click", () => loadReminders());
document.querySelectorAll(".filter-tab").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll(".filter-tab")
      .forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    render();
  }),
);
elements.list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "retry") loadReminders();
  if (button.dataset.action === "edit") openEditor(button.dataset.id);
  if (button.dataset.action === "cancel") cancelReminder(button.dataset.id);
});
setDefaultTime();
loadReminders();
window.setInterval(() => loadReminders({ quiet: true }), 5000);
window.addEventListener("offline", () => setConnection(false, "Browser offline"));
window.addEventListener("online", () => { setConnection(false, "Reconnecting..."); loadReminders(); });
