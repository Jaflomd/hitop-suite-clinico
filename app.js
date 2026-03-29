import { CATEGORY_ORDER, INSTRUMENTS, RESPONSE_SETS } from "./data/catalog.js";
import { buildReport, buildSummaryText, buildTableText, formatNumber } from "./reporting.js";
import {
  DEFAULT_AUTO_LOCK_MS,
  createVault,
  deletePatientAndSessions,
  deleteSession,
  findInProgressSession,
  getSecurityRecord,
  getSession,
  listPatients,
  listSessionsForPatient,
  resetVault,
  savePatient,
  saveSession,
  unlockVault,
} from "./storage.js";

const root = document.getElementById("app-root");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const topbarButton = document.getElementById("reset-app");

const itemCache = new Map();

const state = {
  screen: "boot",
  loading: true,
  loadingMessage: "Abriendo suite local...",
  error: "",
  notice: "",
  security: null,
  search: "",
  category: "all",
  patientSearch: "",
  patientDraft: createEmptyPatientDraft(),
  patientFormMode: "create",
  patients: [],
  patientSessions: [],
  selectedPatientId: null,
  instrument: null,
  items: [],
  responses: {},
  currentIndex: 0,
  tableSorts: {},
  currentSession: null,
};

let vaultKey = null;
let autoLockTimer = null;
let advanceTimer = null;
let persistQueue = Promise.resolve();
let lastActivityTick = 0;
let activityBound = false;

void init();

async function init() {
  topbarButton.addEventListener("click", () => {
    void lockApp("manual");
  });
  bindActivityListeners();
  await bootstrap();
}

async function bootstrap() {
  state.loading = true;
  state.loadingMessage = "Abriendo suite local...";
  render();

  try {
    state.security = await getSecurityRecord();
    state.screen = state.security ? "unlock" : "setup-pin";
  } catch (error) {
    console.error("Bootstrap failed", error);
    state.error = "No pude abrir la base local en este navegador.";
    state.screen = "setup-pin";
  } finally {
    state.loading = false;
    render();
  }
}

function bindActivityListeners() {
  if (activityBound) {
    return;
  }

  const events = ["mousedown", "keydown", "touchstart", "pointerdown"];
  events.forEach((eventName) => {
    window.addEventListener(eventName, markActivity, { passive: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      markActivity();
    }
  });

  activityBound = true;
}

function markActivity() {
  if (!vaultKey) {
    return;
  }

  const now = Date.now();
  if (now - lastActivityTick < 3000) {
    return;
  }

  lastActivityTick = now;
  scheduleAutoLock();
}

function scheduleAutoLock() {
  window.clearTimeout(autoLockTimer);
  if (!vaultKey) {
    return;
  }

  const timeout = state.security?.settings?.autoLockMs || DEFAULT_AUTO_LOCK_MS;
  autoLockTimer = window.setTimeout(() => {
    void lockApp("inactivity");
  }, timeout);
}

function render() {
  configureTopbar();
  syncProgress();
  root.innerHTML = "";

  if (state.loading) {
    renderLoading();
    return;
  }

  switch (state.screen) {
    case "setup-pin":
      renderSetupPin();
      break;
    case "unlock":
      renderUnlock();
      break;
    case "patients":
      renderPatients();
      break;
    case "patient-detail":
      renderPatientDetail();
      break;
    case "catalog":
      renderCatalog();
      break;
    case "intro":
      renderIntro();
      break;
    case "question":
      renderQuestion();
      break;
    case "results":
      renderResults();
      break;
    default:
      renderLoading();
  }
}

function configureTopbar() {
  const showLock = Boolean(vaultKey) && !state.loading && !["setup-pin", "unlock"].includes(state.screen);
  topbarButton.hidden = !showLock;
  topbarButton.textContent = "Bloquear";
}

function syncProgress() {
  if (state.loading) {
    progressBar.style.width = "8%";
    progressLabel.textContent = state.loadingMessage;
    return;
  }

  if (state.screen === "setup-pin") {
    progressBar.style.width = "0%";
    progressLabel.textContent = "Configura un PIN local para activar la boveda.";
    return;
  }

  if (state.screen === "unlock") {
    progressBar.style.width = "0%";
    progressLabel.textContent = "Desbloquea la suite local para acceder a pacientes.";
    return;
  }

  if (state.screen === "patients") {
    progressBar.style.width = "0%";
    progressLabel.textContent = "Gestiona pacientes guardados solo en este dispositivo.";
    return;
  }

  if (state.screen === "patient-detail") {
    const patient = getSelectedPatient();
    progressBar.style.width = "0%";
    progressLabel.textContent = patient ? `${patient.fullName} · historial local` : "Perfil de paciente";
    return;
  }

  if (state.screen === "catalog") {
    progressBar.style.width = "4%";
    progressLabel.textContent = "Selecciona un instrumento para el paciente activo.";
    return;
  }

  if (!state.instrument) {
    progressBar.style.width = "0%";
    progressLabel.textContent = "Preparando instrumento...";
    return;
  }

  if (state.screen === "intro") {
    progressBar.style.width = "8%";
    progressLabel.textContent = `${state.instrument.name} · ${state.instrument.estimatedMinutes}.`;
    return;
  }

  if (state.screen === "question") {
    const width = Math.max(10, Math.round(((state.currentIndex + 1) / Math.max(1, state.items.length)) * 92));
    progressBar.style.width = `${width}%`;
    progressLabel.textContent = `${state.instrument.shortName} · Pregunta ${state.currentIndex + 1} de ${state.items.length}.`;
    return;
  }

  progressBar.style.width = "100%";
  progressLabel.textContent = `${state.instrument.shortName} · reporte listo.`;
}

function renderLoading() {
  root.innerHTML = `
    <section class="screen">
      <div class="result-card">
        <p class="section-label">Cargando suite</p>
        <p class="summary-text">${escapeHtml(state.loadingMessage)}</p>
      </div>
    </section>
  `;
}

function renderSetupPin() {
  const screen = document.createElement("section");
  screen.className = "screen screen-grid screen-grid--hero";
  screen.innerHTML = `
    <div class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Boveda local</p>
        <h2>Configura un PIN para proteger pacientes y evaluaciones.</h2>
        <p class="lede">
          La suite guardara ficha minima del paciente, respuestas crudas, puntajes y reportes
          solo en este dispositivo. Todo queda cifrado localmente.
        </p>
      </div>
      ${renderMessageBlock()}
      <div class="info-row">
        <article class="metric-card">
          <p class="metric-label">Persistencia</p>
          <p class="metric-value">IndexedDB local</p>
        </article>
        <article class="metric-card">
          <p class="metric-label">Seguridad</p>
          <p class="metric-value">PIN + AES-GCM</p>
        </article>
        <article class="metric-card">
          <p class="metric-label">Autobloqueo</p>
          <p class="metric-value">10 minutos</p>
        </article>
      </div>
    </div>

    <aside class="hero">
      <article class="auth-card">
        <p class="section-label">Crear boveda</p>
        <form id="setup-pin-form" class="auth-form">
          <label class="field-group">
            <span class="section-label">PIN local</span>
            <input class="text-input pin-input" type="password" inputmode="numeric" autocomplete="new-password" name="pin" minlength="4" placeholder="Minimo 4 digitos" required />
          </label>
          <label class="field-group">
            <span class="section-label">Confirmar PIN</span>
            <input class="text-input pin-input" type="password" inputmode="numeric" autocomplete="new-password" name="confirmPin" minlength="4" placeholder="Repite el PIN" required />
          </label>
          <button class="primary-button" type="submit">Crear y desbloquear</button>
        </form>
        <p class="footer-note">Si pierdes el PIN, la unica salida del MVP es resetear la base local completa.</p>
      </article>
    </aside>
  `;

  root.appendChild(screen);

  screen.querySelector("#setup-pin-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void handleCreateVault(String(form.get("pin") || ""), String(form.get("confirmPin") || ""));
  });
}

function renderUnlock() {
  const screen = document.createElement("section");
  screen.className = "screen screen-grid screen-grid--hero";
  screen.innerHTML = `
    <div class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Boveda local</p>
        <h2>Desbloquea Psiquiatria basada en medicion.</h2>
        <p class="lede">
          Introduce el PIN local para acceder a pacientes, sesiones guardadas y reportes
          dimensionales en este dispositivo.
        </p>
      </div>
      ${renderMessageBlock()}
      <article class="soft-panel">
        <p class="section-label">Recordatorio</p>
        <p>La suite no sincroniza con nube en esta fase. Todo lo guardado vive y se protege localmente.</p>
      </article>
    </div>

    <aside class="hero">
      <article class="auth-card">
        <p class="section-label">Desbloquear</p>
        <form id="unlock-form" class="auth-form">
          <label class="field-group">
            <span class="section-label">PIN local</span>
            <input class="text-input pin-input" type="password" inputmode="numeric" autocomplete="current-password" name="pin" minlength="4" placeholder="PIN" required />
          </label>
          <button class="primary-button" type="submit">Entrar</button>
        </form>
        <button class="danger-button" type="button" data-action="reset-vault">Reset local completo</button>
        <p class="footer-note">Reset elimina pacientes, sesiones y configuracion de seguridad de este navegador.</p>
      </article>
    </aside>
  `;

  root.appendChild(screen);

  screen.querySelector("#unlock-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void handleUnlock(String(form.get("pin") || ""));
  });

  bindAction(screen, "[data-action='reset-vault']", () => {
    void confirmAndResetVault();
  });
}

function renderPatients() {
  const visiblePatients = getFilteredPatients();
  const screen = document.createElement("section");
  screen.className = "screen screen-grid screen-grid--hero";
  screen.innerHTML = `
    <div class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Pacientes locales</p>
        <h2>Gestiona la ficha clinica minima y el historial dimensional.</h2>
        <p class="lede">
          Crea, edita y abre pacientes guardados en este dispositivo. Cada paciente puede acumular
          multiples instrumentos, sesiones en curso y reportes finales.
        </p>
      </div>

      <div class="info-row">
        <article class="metric-card">
          <p class="metric-label">Pacientes</p>
          <p class="metric-value">${state.patients.length}</p>
        </article>
        <article class="metric-card">
          <p class="metric-label">Visible</p>
          <p class="metric-value">${visiblePatients.length}</p>
        </article>
        <article class="metric-card">
          <p class="metric-label">Sesion</p>
          <p class="metric-value">Desbloqueada</p>
        </article>
      </div>

      ${renderMessageBlock()}

      <div class="soft-panel catalog-toolbar">
        <label class="field-group">
          <span class="section-label">Buscar paciente</span>
          <input id="patient-search" class="text-input" type="text" value="${escapeHtml(state.patientSearch)}" placeholder="Nombre, HC o ID..." />
        </label>
      </div>

      <div class="patient-list">
        ${
          visiblePatients.length
            ? visiblePatients.map((patient) => renderPatientCard(patient)).join("")
            : `
              <article class="empty-state">
                <p class="section-label">Sin resultados</p>
                <p class="summary-text">Todavia no hay pacientes guardados o el filtro no encontro coincidencias.</p>
              </article>
            `
        }
      </div>
    </div>

    <aside class="hero">
      <article class="auth-card">
        <p class="section-label">${state.patientFormMode === "edit" ? "Editar paciente" : "Nuevo paciente"}</p>
        <form id="patient-form" class="patient-form">
          <div class="field-grid">
            <label class="field-group">
              <span class="section-label">Nombre completo</span>
              <input class="text-input" type="text" name="fullName" value="${escapeHtml(state.patientDraft.fullName)}" placeholder="Nombre y apellidos" required />
            </label>
            <label class="field-group">
              <span class="section-label">Historia clinica / ID</span>
              <input class="text-input" type="text" name="recordNumber" value="${escapeHtml(state.patientDraft.recordNumber)}" placeholder="HC-001" required />
            </label>
            <label class="field-group">
              <span class="section-label">Fecha de nacimiento</span>
              <input class="text-input" type="date" name="dateOfBirth" value="${escapeHtml(state.patientDraft.dateOfBirth)}" required />
            </label>
            <label class="field-group">
              <span class="section-label">Sexo</span>
              <select class="select-input" name="sex" required>
                ${renderSexOptions(state.patientDraft.sex)}
              </select>
            </label>
          </div>

          <label class="field-group">
            <span class="section-label">Observaciones breves</span>
            <textarea class="textarea-input" name="notes" rows="4" placeholder="Notas clinicas breves, contexto o advertencias.">${escapeHtml(state.patientDraft.notes)}</textarea>
          </label>

          <div class="cta-row">
            <button class="primary-button" type="submit">${state.patientFormMode === "edit" ? "Guardar cambios" : "Crear paciente"}</button>
            <button class="secondary-button" type="button" data-action="reset-patient-form">Limpiar</button>
          </div>
        </form>
      </article>
    </aside>
  `;

  root.appendChild(screen);

  screen.querySelector("#patient-search").addEventListener("input", (event) => {
    state.patientSearch = event.target.value;
    render();
  });

  screen.querySelector("#patient-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void savePatientFromForm(event.currentTarget);
  });

  bindAction(screen, "[data-action='reset-patient-form']", resetPatientDraft);

  screen.querySelectorAll("[data-open-patient]").forEach((button) => {
    button.addEventListener("click", () => {
      void openPatient(button.dataset.openPatient);
    });
  });

  screen.querySelectorAll("[data-edit-patient]").forEach((button) => {
    button.addEventListener("click", () => {
      loadDraftForPatient(button.dataset.editPatient);
      render();
    });
  });

  screen.querySelectorAll("[data-delete-patient]").forEach((button) => {
    button.addEventListener("click", () => {
      void handleDeletePatient(button.dataset.deletePatient);
    });
  });
}

function renderPatientDetail() {
  const patient = getSelectedPatient();
  if (!patient) {
    state.screen = "patients";
    render();
    return;
  }

  const completedCount = state.patientSessions.filter((session) => session.status === "completed").length;
  const inProgressCount = state.patientSessions.filter((session) => session.status === "in_progress").length;

  const screen = document.createElement("section");
  screen.className = "screen";
  screen.innerHTML = `
    <div class="detail-grid">
      <div class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Perfil del paciente</p>
          <h2>${escapeHtml(patient.fullName)}</h2>
          <p class="lede">Ficha minima local y trazado longitudinal de evaluaciones guardadas.</p>
        </div>

        <div class="patient-summary-grid">
          <article class="result-card">
            <p class="section-label">Historia clinica / ID</p>
            <p class="summary-value">${escapeHtml(patient.recordNumber)}</p>
          </article>
          <article class="result-card">
            <p class="section-label">Fecha de nacimiento</p>
            <p class="summary-value">${escapeHtml(formatDate(patient.dateOfBirth))}</p>
          </article>
          <article class="result-card">
            <p class="section-label">Sexo</p>
            <p class="summary-value">${escapeHtml(patient.sex)}</p>
          </article>
          <article class="result-card">
            <p class="section-label">Observaciones</p>
            <p class="summary-text">${escapeHtml(patient.notes || "Sin observaciones.")}</p>
          </article>
        </div>

        ${renderMessageBlock()}

        <div class="cta-row">
          <button class="primary-button" type="button" data-action="new-assessment">Nueva evaluacion</button>
          <button class="secondary-button" type="button" data-action="edit-patient-detail">Editar ficha</button>
          <button class="ghost-button" type="button" data-action="patients-list">Volver a pacientes</button>
        </div>
      </div>

      <aside class="hero">
        <div class="info-row patient-stats">
          <article class="metric-card">
            <p class="metric-label">Total sesiones</p>
            <p class="metric-value">${state.patientSessions.length}</p>
          </article>
          <article class="metric-card">
            <p class="metric-label">Completadas</p>
            <p class="metric-value">${completedCount}</p>
          </article>
          <article class="metric-card">
            <p class="metric-label">En curso</p>
            <p class="metric-value">${inProgressCount}</p>
          </article>
        </div>
      </aside>
    </div>

    <div class="history-list">
      ${
        state.patientSessions.length
          ? state.patientSessions.map((session) => renderSessionCard(session)).join("")
          : `
            <article class="empty-state">
              <p class="section-label">Sin evaluaciones</p>
              <p class="summary-text">Este paciente aun no tiene instrumentos guardados. Puedes iniciar uno desde "Nueva evaluacion".</p>
            </article>
          `
      }
    </div>
  `;

  root.appendChild(screen);

  bindAction(screen, "[data-action='new-assessment']", () => {
    goToCatalog();
  });
  bindAction(screen, "[data-action='edit-patient-detail']", () => {
    loadDraftForPatient(patient.id);
    state.screen = "patients";
    render();
  });
  bindAction(screen, "[data-action='patients-list']", goToPatients);

  screen.querySelectorAll("[data-open-session]").forEach((button) => {
    button.addEventListener("click", () => {
      void openStoredSession(button.dataset.openSession);
    });
  });

  screen.querySelectorAll("[data-delete-session]").forEach((button) => {
    button.addEventListener("click", () => {
      void handleDeleteSession(button.dataset.deleteSession);
    });
  });
}

function renderCatalog() {
  const patient = getSelectedPatient();
  if (!patient) {
    state.screen = "patients";
    render();
    return;
  }

  const visible = getFilteredInstruments();
  const screen = document.createElement("section");
  screen.className = "screen screen-grid screen-grid--hero";
  screen.innerHTML = `
    <div class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Catalogo para ${escapeHtml(patient.fullName)}</p>
        <h2>Selecciona un instrumento y guardalo en el historial local.</h2>
        <p class="lede">
          Cada aplicacion queda asociada al paciente activo con respuestas, puntajes,
          dimensiones y reporte final cifrados en este dispositivo.
        </p>
      </div>

      <article class="result-card">
        <p class="section-label">Paciente activo</p>
        <p class="summary-value">${escapeHtml(patient.fullName)}</p>
        <p class="summary-text">${escapeHtml(patient.recordNumber)} · ${escapeHtml(formatDate(patient.dateOfBirth))} · ${escapeHtml(patient.sex)}</p>
      </article>

      ${renderMessageBlock()}

      <div class="soft-panel catalog-toolbar">
        <label class="field-group">
          <span class="section-label">Buscar instrumento</span>
          <input id="catalog-search" class="catalog-input" type="text" value="${escapeHtml(state.search)}" placeholder="PHQ-9, PCL-5, TDAH, trauma..." />
        </label>
        <div class="chips-row category-row">
          <button class="pill-button ${state.category === "all" ? "is-active" : ""}" data-category="all" type="button">Todo</button>
          ${CATEGORY_ORDER.map(
            (category) => `
              <button class="pill-button ${state.category === category ? "is-active" : ""}" data-category="${escapeHtml(category)}" type="button">
                ${escapeHtml(category)}
              </button>
            `
          ).join("")}
        </div>
      </div>

      <div class="cta-row">
        <button class="ghost-button" type="button" data-action="patient-detail">Volver al paciente</button>
      </div>

      ${state.error ? `<div class="soft-panel danger-panel">${escapeHtml(state.error)}</div>` : ""}
    </div>

    <aside class="hero">
      <article class="battery-card">
        <div class="card-header">
          <div class="card-copy">
            <p class="card-label">Cobertura visible</p>
            <h3>${visible.length} instrumentos</h3>
            <p>Elige una escala nueva o reanuda una sesion en curso si existe para ese instrumento.</p>
          </div>
          <span class="inline-status">Autosave local</span>
        </div>
      </article>

      <div class="catalog-grid">
        ${visible
          .map(
            (instrument) => `
              <button class="catalog-card" type="button" data-instrument-id="${instrument.id}">
                <div class="catalog-card-top">
                  <p class="card-label">${escapeHtml(instrument.category)}</p>
                  <strong>${escapeHtml(instrument.shortName)}</strong>
                </div>
                <p class="catalog-title">${escapeHtml(instrument.name)}</p>
                <p class="catalog-copy">${escapeHtml(instrument.description)}</p>
                <div class="chips-row">
                  ${instrument.coverage.slice(0, 3).map((tag) => `<span class="pill subtle">${escapeHtml(formatCoverage(tag))}</span>`).join("")}
                </div>
                <div class="catalog-meta">
                  <span>${escapeHtml(instrument.timeframe)}</span>
                  <span>${escapeHtml(instrument.estimatedMinutes)}</span>
                </div>
              </button>
            `
          )
          .join("")}
      </div>
    </aside>
  `;

  root.appendChild(screen);

  screen.querySelector("#catalog-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  screen.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      render();
    });
  });

  screen.querySelectorAll("[data-instrument-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void chooseInstrument(button.dataset.instrumentId);
    });
  });

  bindAction(screen, "[data-action='patient-detail']", () => {
    state.screen = "patient-detail";
    render();
  });
}

function renderIntro() {
  const patient = getSelectedPatient();
  const instrument = state.instrument;
  const screen = document.createElement("section");
  screen.className = "screen screen-grid screen-grid--hero";
  screen.innerHTML = `
    <div class="hero">
      <div class="hero-copy">
        <p class="eyebrow">${escapeHtml(instrument.category)}</p>
        <h2>${escapeHtml(instrument.name)}</h2>
        <p class="lede">${escapeHtml(instrument.description)}</p>
      </div>

      <article class="battery-card">
        <div class="card-header">
          <div class="card-copy">
            <p class="card-label">Aplicacion</p>
            <h3>Lo que veras</h3>
            <p>${escapeHtml(instrument.timeframe)} · ${escapeHtml(instrument.estimatedMinutes)} · una pregunta por pantalla.</p>
          </div>
          <span class="inline-status">${state.items.length} items</span>
        </div>
        <div class="chips-row">
          ${instrument.coverage.map((tag) => `<span class="pill">${escapeHtml(formatCoverage(tag))}</span>`).join("")}
        </div>
      </article>

      ${renderMessageBlock()}

      <div class="cta-row">
        <button class="primary-button" data-action="begin" type="button">Empezar</button>
        <button class="secondary-button" data-action="back" type="button">Volver al catalogo</button>
      </div>
    </div>

    <aside class="hero">
      <article class="soft-panel">
        <p class="section-label">Paciente activo</p>
        <p class="summary-value">${escapeHtml(patient?.fullName || "")}</p>
        <p class="summary-text">${escapeHtml(patient?.recordNumber || "")}</p>
      </article>
      <article class="soft-panel">
        <p class="section-label">Modo de uso</p>
        <p>Las respuestas se guardan automaticamente dentro de la sesion local del paciente.</p>
      </article>
      <article class="soft-panel">
        <p class="section-label">Nota</p>
        <p>Esto es apoyo para cribado y organizacion clinica; no reemplaza juicio profesional.</p>
      </article>
    </aside>
  `;

  root.appendChild(screen);

  bindAction(screen, "[data-action='begin']", () => {
    void beginAssessmentSession();
  });
  bindAction(screen, "[data-action='back']", goToCatalog);
}

function renderQuestion() {
  const item = state.items[state.currentIndex];
  if (!item) {
    state.screen = "results";
    render();
    return;
  }

  const patient = getSelectedPatient();
  const prompts = resolvePrompts(item);
  const screen = document.createElement("section");
  screen.className = "screen";
  screen.innerHTML = `
    <div class="question-layout">
      <div class="question-card">
        <div class="question-meta">
          <span>${escapeHtml(state.instrument.shortName)} · ${escapeHtml(patient?.recordNumber || "")}</span>
          <span>${state.currentIndex + 1} / ${state.items.length}</span>
        </div>
        <h2 class="question-text">${escapeHtml(item.text)}</h2>
        <p class="question-helper">${escapeHtml(state.instrument.timeframe)} · guardado automatico local para ${escapeHtml(patient?.fullName || "paciente activo")}.</p>
      </div>

      <div class="answer-scale answer-scale--stacked">
        ${prompts.map((prompt) => renderPromptBlock(item, prompt)).join("")}
      </div>

      <div class="question-footer">
        <p class="saved-note">${state.notice || "&nbsp;"}</p>
        <div class="question-nav">
          <button class="secondary-button" type="button" data-action="prev" ${state.currentIndex === 0 ? "disabled" : ""}>Anterior</button>
          <button class="primary-button" type="button" data-action="next" ${!isItemComplete(item) ? "disabled" : ""}>
            ${state.currentIndex >= state.items.length - 1 ? "Ver reporte" : "Siguiente"}
          </button>
        </div>
      </div>
    </div>
  `;

  root.appendChild(screen);

  screen.querySelectorAll("[data-prompt-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const promptKey = button.dataset.promptKey || null;
      const value = Number(button.dataset.promptOption);
      setResponse(item, promptKey, value);
    });
  });

  screen.querySelectorAll("[data-numeric-input]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const nextValue = event.target.value === "" ? null : Math.max(0, Number(event.target.value));
      setResponse(item, event.target.dataset.promptKey || null, nextValue, { autoAdvance: false });
    });
  });

  bindAction(screen, "[data-action='prev']", goPrev);
  bindAction(screen, "[data-action='next']", goNext);
}

function renderPromptBlock(item, prompt) {
  const value = getPromptValue(item, prompt.id);

  if (prompt.responseSetId === "numberMonths") {
    return `
      <div class="prompt-block">
        <p class="section-label">${escapeHtml(prompt.label || "Tiempo")}</p>
        <input
          class="numeric-input"
          type="number"
          min="0"
          step="1"
          data-numeric-input="true"
          data-prompt-key="${escapeHtml(prompt.id || "")}"
          value="${value ?? ""}"
          placeholder="Meses"
        />
      </div>
    `;
  }

  const options = prompt.options || RESPONSE_SETS[prompt.responseSetId] || RESPONSE_SETS[state.instrument.defaultResponseSetId] || [];

  return `
    <div class="prompt-block">
      ${prompt.label ? `<p class="section-label">${escapeHtml(prompt.label)}</p>` : ""}
      <div class="prompt-options">
        ${options
          .map(
            (entry) => `
              <button
                class="answer-button ${value === entry.value ? "is-selected" : ""}"
                type="button"
                data-prompt-option="${entry.value}"
                data-prompt-key="${escapeHtml(prompt.id || "")}"
              >
                <strong>${escapeHtml(entry.label)}</strong>
                ${entry.hint ? `<span>${escapeHtml(entry.hint)}</span>` : ""}
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderResults() {
  const patient = getSelectedPatient();
  const report = buildReport(state.instrument, state.items, state.responses);
  const sortedTables = report.tables.map((table, tableIndex) => getSortedTable(table, tableIndex));

  if (state.currentSession?.status !== "completed") {
    void persistCurrentSession({ markCompleted: true, report });
  }

  const screen = document.createElement("section");
  screen.className = "screen";
  screen.innerHTML = `
    <div class="results-layout">
      <div class="results-hero">
        <p class="eyebrow">${escapeHtml(state.instrument.category)} · ${escapeHtml(patient?.fullName || "")}</p>
        <h2>${escapeHtml(state.instrument.name)}</h2>
        <p class="lede">${escapeHtml(report.summary)}</p>

        <div class="cta-row">
          <button class="primary-button" data-action="copy-summary" type="button">Copiar resumen</button>
          <button class="secondary-button" data-action="copy-table" type="button">Copiar tabla</button>
          <button class="secondary-button" data-action="edit" type="button">Editar respuestas</button>
          <button class="secondary-button" data-action="patient" type="button">Perfil paciente</button>
          <button class="ghost-button" data-action="catalog" type="button">Otro instrumento</button>
        </div>
        <p class="saved-note">${state.notice || "&nbsp;"}</p>

        <div class="summary-panel">
          ${report.scores
            .map(
              (score) => `
                <article class="result-card">
                  <p class="summary-label">${escapeHtml(score.label)}</p>
                  <p class="summary-value">${escapeHtml(score.display)}</p>
                  ${score.band ? `<p class="summary-text">${escapeHtml(score.band)}</p>` : ""}
                  ${score.note ? `<p class="footer-note">${escapeHtml(score.note)}</p>` : ""}
                </article>
              `
            )
            .join("")}
        </div>

        ${
          report.alerts.length
            ? `
              <article class="result-card">
                <p class="section-label">Alertas o puntos de corte</p>
                <ul class="result-list">
                  ${report.alerts.map((alert) => `<li>${escapeHtml(alert)}</li>`).join("")}
                </ul>
              </article>
            `
            : ""
        }

        ${
          sortedTables.length
            ? sortedTables
                .map(
                  (table, tableIndex) => `
                    <article class="result-card">
                      <p class="section-label">${escapeHtml(table.title)}</p>
                      <div class="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              ${table.columns
                                .map((column, columnIndex) => `<th>${renderTableHeader(tableIndex, columnIndex, column)}</th>`)
                                .join("")}
                            </tr>
                          </thead>
                          <tbody>
                            ${table.rows
                              .map(
                                (row) => `
                                  <tr>
                                    ${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}
                                  </tr>
                                `
                              )
                              .join("")}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  `
                )
                .join("")
            : ""
        }
      </div>

      <aside class="result-copy">
        <article class="result-card">
          <p class="section-label">Reporte dimensional</p>
          <div class="spectrum-list">
            ${report.dimensions
              .map(
                (entry) => `
                  <div class="spectrum-meter">
                    <div class="meter-header">
                      <span class="meter-label">${escapeHtml(entry.label)}</span>
                      <span class="meter-value">${escapeHtml(entry.valueLabel)}</span>
                    </div>
                    <div class="meter-track">
                      <div class="meter-fill" style="width: ${entry.percent}%"></div>
                    </div>
                    <p class="footer-note">${escapeHtml(entry.note)}</p>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>

        <article class="result-card">
          <p class="section-label">Cobertura del instrumento</p>
          <div class="chips-row">
            ${state.instrument.coverage.map((tag) => `<span class="pill">${escapeHtml(formatCoverage(tag))}</span>`).join("")}
          </div>
        </article>
      </aside>
    </div>
  `;

  root.appendChild(screen);

  bindAction(screen, "[data-action='copy-summary']", async () => {
    await copyText(buildSummaryText(state.instrument.name, report), "Resumen copiado.");
  });
  bindAction(screen, "[data-action='copy-table']", async () => {
    await copyText(buildTableText(state.instrument.name, report, sortedTables), "Tabla copiada.");
  });
  bindAction(screen, "[data-action='edit']", () => {
    state.currentIndex = 0;
    state.notice = "";
    state.screen = "question";
    render();
  });
  bindAction(screen, "[data-action='patient']", () => {
    state.screen = "patient-detail";
    render();
  });
  bindAction(screen, "[data-action='catalog']", goToCatalog);

  screen.querySelectorAll("[data-sort-table]").forEach((button) => {
    button.addEventListener("click", () => {
      const tableIndex = Number(button.dataset.sortTable);
      const columnIndex = Number(button.dataset.sortColumn);
      toggleTableSort(tableIndex, columnIndex, sortedTables[tableIndex]);
    });
  });
}

function renderTableHeader(tableIndex, columnIndex, column) {
  const activeSort = state.tableSorts[tableIndex];
  const isActive = activeSort?.column === columnIndex;
  const indicator = isActive ? (activeSort.direction === "desc" ? "↓" : "↑") : "↕";
  return `
    <button
      class="table-sort-button ${isActive ? "is-active" : ""}"
      type="button"
      data-sort-table="${tableIndex}"
      data-sort-column="${columnIndex}"
    >
      <span>${escapeHtml(column)}</span>
      <span class="sort-indicator" aria-hidden="true">${indicator}</span>
    </button>
  `;
}

function bindAction(container, selector, handler) {
  const node = container.querySelector(selector);
  if (!node) {
    return;
  }
  node.addEventListener("click", handler);
}

async function handleCreateVault(pin, confirmPin) {
  state.error = "";
  state.notice = "";

  if (!/^\d{4,}$/.test(pin)) {
    state.error = "El PIN debe tener al menos 4 digitos.";
    render();
    return;
  }

  if (pin !== confirmPin) {
    state.error = "Los PIN no coinciden.";
    render();
    return;
  }

  state.loading = true;
  state.loadingMessage = "Creando boveda local...";
  render();

  try {
    const { record, key } = await createVault(pin);
    vaultKey = key;
    state.security = record;
    await refreshPatients();
    resetPatientDraft();
    scheduleAutoLock();
    state.notice = "Boveda creada y desbloqueada.";
    state.screen = "patients";
  } catch (error) {
    console.error("Vault creation failed", error);
    state.error = "No pude crear la boveda local.";
  } finally {
    state.loading = false;
    render();
  }
}

async function handleUnlock(pin) {
  state.error = "";
  state.notice = "";
  state.loading = true;
  state.loadingMessage = "Desbloqueando suite...";
  render();

  try {
    const result = await unlockVault(pin);
    if (!result.ok) {
      state.error = result.reason === "invalid-pin" ? "PIN incorrecto." : "No encontre configuracion de seguridad.";
      state.screen = result.reason === "missing-security" ? "setup-pin" : "unlock";
      return;
    }

    vaultKey = result.key;
    state.security = result.record;
    scheduleAutoLock();
    await refreshPatients();
    resetPatientDraft();
    state.screen = "patients";
    state.notice = "Suite desbloqueada.";
  } catch (error) {
    console.error("Unlock failed", error);
    state.error = "No pude desbloquear la boveda local.";
  } finally {
    state.loading = false;
    render();
  }
}

async function lockApp(reason = "manual") {
  clearPendingAdvance();
  window.clearTimeout(autoLockTimer);
  autoLockTimer = null;
  vaultKey = null;
  persistQueue = Promise.resolve();
  state.security = await getSecurityRecord().catch(() => state.security);
  state.notice = reason === "inactivity" ? "La suite se bloqueo por inactividad." : "";
  state.error = "";
  state.patientSearch = "";
  state.search = "";
  state.category = "all";
  state.patients = [];
  state.patientSessions = [];
  state.selectedPatientId = null;
  resetPatientDraft();
  clearAssessmentContext();
  state.screen = state.security ? "unlock" : "setup-pin";
  render();
}

async function confirmAndResetVault() {
  const confirmed = window.confirm("Esto eliminara pacientes, sesiones y configuracion de seguridad de este navegador. Continuar?");
  if (!confirmed) {
    return;
  }

  state.loading = true;
  state.loadingMessage = "Reseteando base local...";
  render();

  try {
    await resetVault();
    vaultKey = null;
    persistQueue = Promise.resolve();
    state.security = null;
    state.patients = [];
    state.patientSessions = [];
    state.selectedPatientId = null;
    resetPatientDraft();
    clearAssessmentContext();
    state.error = "";
    state.notice = "La base local fue reseteada.";
    state.screen = "setup-pin";
  } catch (error) {
    console.error("Reset vault failed", error);
    state.error = "No pude resetear la base local.";
    state.screen = "unlock";
  } finally {
    state.loading = false;
    render();
  }
}

async function refreshPatients() {
  if (!vaultKey) {
    state.patients = [];
    return;
  }

  state.patients = await listPatients(vaultKey);
  if (state.selectedPatientId && !state.patients.some((patient) => patient.id === state.selectedPatientId)) {
    state.selectedPatientId = null;
    state.patientSessions = [];
  }
}

async function refreshPatientSessions() {
  if (!vaultKey || !state.selectedPatientId) {
    state.patientSessions = [];
    return;
  }

  state.patientSessions = await listSessionsForPatient(vaultKey, state.selectedPatientId);
}

async function savePatientFromForm(form) {
  const formData = new FormData(form);
  const draft = {
    ...state.patientDraft,
    fullName: String(formData.get("fullName") || "").trim(),
    recordNumber: String(formData.get("recordNumber") || "").trim(),
    dateOfBirth: String(formData.get("dateOfBirth") || "").trim(),
    sex: String(formData.get("sex") || "").trim(),
    notes: String(formData.get("notes") || "").trim(),
  };

  if (!draft.fullName || !draft.recordNumber || !draft.dateOfBirth || !draft.sex) {
    state.error = "Completa nombre, HC/ID, fecha de nacimiento y sexo.";
    render();
    return;
  }

  const now = new Date().toISOString();
  const patient = {
    id: draft.id || crypto.randomUUID(),
    fullName: draft.fullName,
    recordNumber: draft.recordNumber,
    dateOfBirth: draft.dateOfBirth,
    sex: draft.sex,
    notes: draft.notes,
    createdAt: draft.createdAt || now,
    updatedAt: now,
  };

  state.loading = true;
  state.loadingMessage = "Guardando paciente...";
  render();

  try {
    await savePatient(vaultKey, patient);
    await refreshPatients();
    resetPatientDraft();
    state.notice = "Paciente guardado localmente.";
    await openPatient(patient.id);
  } catch (error) {
    console.error("Save patient failed", error);
    state.loading = false;
    state.error = "No pude guardar el paciente.";
    render();
  }
}

function loadDraftForPatient(patientId) {
  const patient = state.patients.find((entry) => entry.id === patientId);
  if (!patient) {
    return;
  }

  state.patientDraft = {
    ...patient,
  };
  state.patientFormMode = "edit";
  state.notice = "";
  state.error = "";
}

function resetPatientDraft() {
  state.patientDraft = createEmptyPatientDraft();
  state.patientFormMode = "create";
  state.error = "";
}

async function openPatient(patientId) {
  state.loading = true;
  state.loadingMessage = "Cargando perfil del paciente...";
  render();

  try {
    state.selectedPatientId = patientId;
    await refreshPatientSessions();
    state.screen = "patient-detail";
    state.error = "";
  } catch (error) {
    console.error("Open patient failed", error);
    state.error = "No pude abrir el paciente.";
  } finally {
    state.loading = false;
    render();
  }
}

async function handleDeletePatient(patientId) {
  const patient = state.patients.find((entry) => entry.id === patientId);
  const confirmed = window.confirm(`Eliminar a ${patient?.fullName || "este paciente"} y todas sus sesiones?`);
  if (!confirmed) {
    return;
  }

  state.loading = true;
  state.loadingMessage = "Eliminando paciente...";
  render();

  try {
    await deletePatientAndSessions(patientId);
    if (state.selectedPatientId === patientId) {
      state.selectedPatientId = null;
      state.patientSessions = [];
      clearAssessmentContext();
    }
    await refreshPatients();
    state.notice = "Paciente eliminado.";
    state.screen = "patients";
  } catch (error) {
    console.error("Delete patient failed", error);
    state.error = "No pude eliminar el paciente.";
  } finally {
    state.loading = false;
    render();
  }
}

async function handleDeleteSession(sessionId) {
  const session = state.patientSessions.find((entry) => entry.id === sessionId);
  const confirmed = window.confirm(`Eliminar la sesion ${session?.instrumentName || ""}?`);
  if (!confirmed) {
    return;
  }

  state.loading = true;
  state.loadingMessage = "Eliminando sesion...";
  render();

  try {
    await deleteSession(sessionId);
    await refreshPatientSessions();
    await refreshPatients();
    state.notice = "Sesion eliminada.";
  } catch (error) {
    console.error("Delete session failed", error);
    state.error = "No pude eliminar la sesion.";
  } finally {
    state.loading = false;
    render();
  }
}

function goToPatients() {
  clearAssessmentContext();
  state.screen = "patients";
  state.notice = "";
  state.error = "";
  render();
}

function goToCatalog() {
  clearPendingAdvance();
  clearAssessmentContext();
  state.screen = state.selectedPatientId ? "catalog" : "patients";
  state.notice = "";
  state.error = "";
  render();
}

function clearAssessmentContext() {
  state.instrument = null;
  state.items = [];
  state.responses = {};
  state.currentIndex = 0;
  state.tableSorts = {};
  state.currentSession = null;
}

async function chooseInstrument(id) {
  if (!state.selectedPatientId) {
    state.screen = "patients";
    render();
    return;
  }

  const instrument = INSTRUMENTS.find((entry) => entry.id === id);
  if (!instrument) {
    return;
  }

  clearPendingAdvance();
  state.loading = true;
  state.loadingMessage = `Cargando ${instrument.name}...`;
  state.error = "";
  render();

  try {
    const items = await loadInstrumentItems(instrument);
    state.instrument = instrument;
    state.items = items;
    state.responses = {};
    state.currentIndex = 0;
    state.currentSession = null;
    state.tableSorts = {};
    state.notice = "";
    state.screen = "intro";
  } catch (error) {
    console.error("Instrument load failed", instrument.id, error);
    state.error = `No pude cargar ${instrument.name}.`;
    state.screen = "catalog";
  } finally {
    state.loading = false;
    render();
  }
}

async function beginAssessmentSession() {
  if (!vaultKey || !state.selectedPatientId || !state.instrument) {
    return;
  }

  state.loading = true;
  state.loadingMessage = "Preparando sesion...";
  render();

  try {
    const existing = await findInProgressSession(vaultKey, state.selectedPatientId, state.instrument.id);
    if (existing) {
      state.currentSession = existing;
      state.responses = existing.responses || {};
      state.currentIndex = computeResumeIndex(state.items, state.responses, existing.progressIndex);
      state.notice = "Sesion reanudada.";
    } else {
      const now = new Date().toISOString();
      state.currentSession = {
        id: crypto.randomUUID(),
        patientId: state.selectedPatientId,
        instrumentId: state.instrument.id,
        instrumentName: state.instrument.name,
        startedAt: now,
        completedAt: null,
        status: "in_progress",
        progressIndex: 0,
        responses: {},
        scores: [],
        dimensions: [],
        alerts: [],
        reportText: "",
        tableText: "",
        createdAt: now,
        updatedAt: now,
      };
      state.responses = {};
      state.currentIndex = 0;
      await saveSession(vaultKey, state.currentSession);
      await refreshPatientSessions();
      state.notice = "Sesion creada.";
    }

    state.screen = "question";
  } catch (error) {
    console.error("Begin assessment failed", error);
    state.error = "No pude preparar la sesion del instrumento.";
    state.screen = "catalog";
  } finally {
    state.loading = false;
    render();
  }
}

async function openStoredSession(sessionId) {
  if (!vaultKey) {
    return;
  }

  state.loading = true;
  state.loadingMessage = "Abriendo sesion guardada...";
  render();

  try {
    const session = await getSession(vaultKey, sessionId);
    if (!session) {
      throw new Error("missing-session");
    }

    const instrument = INSTRUMENTS.find((entry) => entry.id === session.instrumentId);
    if (!instrument) {
      throw new Error("missing-instrument");
    }

    const items = await loadInstrumentItems(instrument);
    state.instrument = instrument;
    state.items = items;
    state.responses = session.responses || {};
    state.currentSession = session;
    state.currentIndex = computeResumeIndex(items, state.responses, session.progressIndex);
    state.tableSorts = {};
    state.notice = session.status === "completed" ? "" : "Sesion reanudada.";
    state.screen = session.status === "completed" ? "results" : "question";
  } catch (error) {
    console.error("Open stored session failed", error);
    state.error = "No pude abrir la sesion guardada.";
    state.screen = "patient-detail";
  } finally {
    state.loading = false;
    render();
  }
}

async function persistCurrentSession({ markCompleted = false, report = null } = {}) {
  if (!vaultKey || !state.currentSession || !state.instrument) {
    return;
  }

  const activeKey = vaultKey;
  const currentReport = report || (allItemsComplete() ? buildReport(state.instrument, state.items, state.responses) : null);
  const now = new Date().toISOString();
  const completed = Boolean(markCompleted);

  const nextSession = {
    ...state.currentSession,
    instrumentId: state.instrument.id,
    instrumentName: state.instrument.name,
    responses: structuredClone(state.responses),
    progressIndex: computePersistedProgressIndex(completed),
    status: completed ? "completed" : "in_progress",
    completedAt: completed ? state.currentSession.completedAt || now : null,
    scores: currentReport ? currentReport.scores : state.currentSession.scores || [],
    dimensions: currentReport ? currentReport.dimensions : state.currentSession.dimensions || [],
    alerts: currentReport ? currentReport.alerts : state.currentSession.alerts || [],
    reportText: currentReport ? buildSummaryText(state.instrument.name, currentReport) : state.currentSession.reportText || "",
    tableText: currentReport ? buildTableText(state.instrument.name, currentReport) : state.currentSession.tableText || "",
    updatedAt: now,
  };

  state.currentSession = nextSession;
  if (completed) {
    state.notice = "Evaluacion guardada en el historial local.";
  }

  await queuePersist(async () => {
    if (!activeKey) {
      return;
    }
    await saveSession(activeKey, nextSession);
    if (state.selectedPatientId === nextSession.patientId) {
      await refreshPatientSessions();
    }
  });
}

function queuePersist(task) {
  persistQueue = persistQueue
    .then(task)
    .catch((error) => {
      console.error("Persist failed", error);
      state.error = "No pude guardar localmente la ultima actualizacion.";
      render();
    });

  return persistQueue;
}

function computePersistedProgressIndex(markCompleted = false) {
  if (markCompleted) {
    return Math.max(0, state.items.length - 1);
  }

  const currentItem = state.items[state.currentIndex];
  if (!currentItem) {
    return state.currentIndex;
  }

  if (isItemComplete(currentItem) && state.currentIndex < state.items.length - 1) {
    return state.currentIndex + 1;
  }

  return state.currentIndex;
}

function computeResumeIndex(items, responses, storedIndex = 0) {
  const firstIncomplete = items.findIndex((item) => !isItemCompleteForResponses(item, responses));
  if (firstIncomplete === -1) {
    return Math.max(0, Math.min(items.length - 1, storedIndex || items.length - 1));
  }

  return Math.max(0, Math.min(firstIncomplete, storedIndex ?? firstIncomplete));
}

async function loadInstrumentItems(instrument) {
  if (itemCache.has(instrument.id)) {
    return structuredClone(itemCache.get(instrument.id));
  }

  let items = [];

  if (instrument.source.type === "inline") {
    items = instrument.items.map((item, index) => normalizeInlineItem(item, instrument, index));
  } else if (instrument.source.type === "markdown") {
    const response = await fetch(encodeURI(instrument.source.path));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const markdown = await response.text();
    const parsed = instrument.source.parseMode === "numbered" ? parseNumberedMarkdown(markdown) : parseTableMarkdown(markdown);
    items = parsed.map((item, index) => normalizeParsedItem(item, instrument, index));
  }

  itemCache.set(instrument.id, items);
  return structuredClone(items);
}

function normalizeInlineItem(item, instrument, index) {
  return {
    id: item.id || `${instrument.id}-${index + 1}`,
    number: index + 1,
    text: item.text,
    responseSetId: item.responseSetId || instrument.defaultResponseSetId || null,
    options: item.options || null,
    prompts: item.prompts || null,
  };
}

function normalizeParsedItem(item, instrument, index) {
  const responseSetId = instrument.responseSetOverrides?.[index + 1] || instrument.defaultResponseSetId || null;
  return {
    id: `${instrument.id}-${index + 1}`,
    number: index + 1,
    text: item.text,
    responseSetId,
    options: item.options?.length ? item.options : null,
    prompts: null,
  };
}

function makeOption(value, label, hint = "") {
  return { value, label, hint };
}

function parseTableMarkdown(markdown) {
  const lines = markdown.split("\n").map((line) => line.trim()).filter(Boolean);
  const items = [];
  let headerCells = null;
  let inTable = false;

  lines.forEach((line) => {
    if (!line.startsWith("|")) {
      inTable = false;
      return;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cleanMarkdown(cell));

    if (!inTable) {
      headerCells = cells;
      inTable = true;
      return;
    }

    if (cells.every((cell) => /^:?-+:?$/.test(cell))) {
      return;
    }

    const firstCell = stripLeadingNumber(cells[0]);
    if (!firstCell || firstCell.endsWith(":") || firstCell === "Pregunta") {
      return;
    }

    const options = [];
    for (let index = 1; index < cells.length; index += 1) {
      const rawCell = cells[index];
      if (!rawCell || isSelectionMarkerCell(rawCell)) {
        continue;
      }
      const headerLabel = cleanMarkdown(headerCells?.[index] || "");
      const headerValue = extractLastNumber(headerLabel);
      const rawValue = extractLastNumber(rawCell);
      const rawLooksNumeric = /^[+-]?\d+([.,]\d+)?$/.test(rawCell);
      const headerLooksNumeric = /^[+-]?\d+([.,]\d+)?$/.test(headerLabel);

      let value = index - 1;
      let label = rawCell.replace(/\(\d+\)/g, "").trim();

      if (rawLooksNumeric) {
        value = rawValue ?? index - 1;
        label = headerLabel;
      } else if (headerLooksNumeric) {
        value = rawValue ?? headerValue ?? index - 1;
      } else if (rawValue !== null && headerLabel) {
        value = rawValue;
        label = headerLabel;
      }

      options.push(makeOption(value, label));
    }

    items.push({
      text: firstCell,
      options,
    });
  });

  return items;
}

function parseNumberedMarkdown(markdown) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\./.test(line))
    .map((line) => {
      const withoutNumber = line.replace(/^\d+\.\s*/, "");
      const clean = cleanMarkdown(withoutNumber);
      const parts = clean.split(":");
      const text = clean.startsWith("¿") || parts.length === 1 ? clean : parts.slice(1).join(":").trim();
      return {
        text: stripLeadingNumber(text),
      };
    });
}

function cleanMarkdown(text) {
  return text.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

function isSelectionMarkerCell(text) {
  return /^\[\s*[xX]?\s*\]\*?$/.test(text.trim());
}

function extractLastNumber(text) {
  const matches = text.match(/-?\d+(?:[.,]\d+)?/g);
  if (!matches?.length) {
    return null;
  }

  return Number(matches[matches.length - 1].replace(",", "."));
}

function stripLeadingNumber(text) {
  return text.replace(/^\d+\.\s*/, "").trim();
}

function getFilteredInstruments() {
  const query = state.search.trim().toLowerCase();
  return INSTRUMENTS.filter((instrument) => {
    if (state.category !== "all" && instrument.category !== state.category) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      instrument.name,
      instrument.shortName,
      instrument.description,
      instrument.category,
      ...instrument.coverage,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function getFilteredPatients() {
  const query = state.patientSearch.trim().toLowerCase();
  if (!query) {
    return state.patients;
  }

  return state.patients.filter((patient) => {
    const haystack = [patient.fullName, patient.recordNumber, patient.dateOfBirth, patient.sex, patient.notes].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function resolvePrompts(item) {
  if (item.prompts?.length) {
    return item.prompts.map((prompt) => ({
      ...prompt,
      options: prompt.options || RESPONSE_SETS[prompt.responseSetId] || [],
    }));
  }

  return [
    {
      id: null,
      label: null,
      responseSetId: item.responseSetId,
      options: item.options || RESPONSE_SETS[item.responseSetId] || [],
    },
  ];
}

function getPromptValue(item, promptId) {
  return getPromptValueFromResponses(state.responses, item.id, promptId);
}

function getPromptValueFromResponses(responses, itemId, promptId) {
  const stored = responses[itemId];
  if (stored === undefined || stored === null) {
    return null;
  }
  if (typeof stored === "object" && promptId) {
    return stored[promptId] ?? null;
  }
  if (typeof stored === "number") {
    return stored;
  }
  return null;
}

function setResponse(item, promptId, value, options = {}) {
  clearPendingAdvance();

  if (promptId) {
    const next = typeof state.responses[item.id] === "object" && state.responses[item.id] !== null ? { ...state.responses[item.id] } : {};
    next[promptId] = value;
    state.responses[item.id] = next;
  } else {
    state.responses[item.id] = value;
  }

  state.notice = "Guardado local automatico.";
  void persistCurrentSession();
  render();

  if (options.autoAdvance === false) {
    return;
  }

  if (isItemComplete(item) && shouldAutoAdvance(item)) {
    advanceTimer = window.setTimeout(() => {
      goNext();
    }, 180);
  }
}

function shouldAutoAdvance(item) {
  return resolvePrompts(item).every((prompt) => prompt.responseSetId !== "numberMonths");
}

function isItemComplete(item) {
  return isItemCompleteForResponses(item, state.responses);
}

function isItemCompleteForResponses(item, responses) {
  const prompts = resolvePrompts(item);
  return prompts.every((prompt) => {
    const value = getPromptValueFromResponses(responses, item.id, prompt.id);
    return value !== null && value !== undefined && value !== "";
  });
}

function allItemsComplete() {
  return state.items.every((item) => isItemCompleteForResponses(item, state.responses));
}

function goPrev() {
  clearPendingAdvance();
  state.currentIndex = Math.max(0, state.currentIndex - 1);
  state.notice = "";
  void persistCurrentSession();
  render();
}

function goNext() {
  clearPendingAdvance();
  const current = state.items[state.currentIndex];
  if (!current || !isItemComplete(current)) {
    return;
  }

  if (state.currentIndex >= state.items.length - 1) {
    state.screen = "results";
    state.notice = "";
    render();
    return;
  }

  state.currentIndex += 1;
  state.notice = "";
  void persistCurrentSession();
  render();
}

function clearPendingAdvance() {
  if (advanceTimer) {
    window.clearTimeout(advanceTimer);
    advanceTimer = null;
  }
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    state.notice = message;
  } catch (error) {
    state.error = "No pude copiar automaticamente.";
  }
  render();
}

function getSelectedPatient() {
  return state.patients.find((patient) => patient.id === state.selectedPatientId) || null;
}

function createEmptyPatientDraft() {
  return {
    id: "",
    fullName: "",
    recordNumber: "",
    dateOfBirth: "",
    sex: "",
    notes: "",
    createdAt: "",
    updatedAt: "",
  };
}

function renderPatientCard(patient) {
  return `
    <article class="patient-card">
      <div class="patient-card-head">
        <div class="info-stack">
          <p class="section-label">${escapeHtml(patient.recordNumber)}</p>
          <h3>${escapeHtml(patient.fullName)}</h3>
        </div>
        <span class="status-chip is-completed">Local</span>
      </div>
      <p class="summary-text">${escapeHtml(formatDate(patient.dateOfBirth))} · ${escapeHtml(patient.sex)}</p>
      <p class="footer-note">${escapeHtml(patient.notes || "Sin observaciones.")}</p>
      <div class="patient-actions">
        <button class="primary-button" type="button" data-open-patient="${patient.id}">Abrir</button>
        <button class="secondary-button" type="button" data-edit-patient="${patient.id}">Editar</button>
        <button class="danger-button" type="button" data-delete-patient="${patient.id}">Eliminar</button>
      </div>
    </article>
  `;
}

function renderSessionCard(session) {
  const primaryScore = session.scores?.[0];
  const primaryDimension = session.dimensions?.[0];
  const answeredItems = Object.keys(session.responses || {}).length;

  return `
    <article class="history-card">
      <div class="patient-card-head">
        <div class="info-stack">
          <p class="section-label">${escapeHtml(formatDateTime(session.updatedAt))}</p>
          <h3>${escapeHtml(session.instrumentName)}</h3>
        </div>
        <span class="status-chip ${session.status === "completed" ? "is-completed" : "is-progress"}">
          ${session.status === "completed" ? "Completada" : "En curso"}
        </span>
      </div>
      <p class="summary-text">
        ${
          primaryScore
            ? `${escapeHtml(primaryScore.label)} · ${escapeHtml(primaryScore.display)}`
            : `${answeredItems} respuestas guardadas`
        }
      </p>
      <p class="footer-note">
        ${primaryDimension ? escapeHtml(`${primaryDimension.label}: ${primaryDimension.valueLabel}`) : "Sin dimension final aun."}
      </p>
      <div class="history-actions">
        <button class="secondary-button" type="button" data-open-session="${session.id}">
          ${session.status === "completed" ? "Ver reporte" : "Continuar"}
        </button>
        <button class="danger-button" type="button" data-delete-session="${session.id}">Eliminar</button>
      </div>
    </article>
  `;
}

function renderMessageBlock() {
  if (!state.error && !state.notice) {
    return "";
  }

  if (state.error) {
    return `<div class="soft-panel danger-panel">${escapeHtml(state.error)}</div>`;
  }

  return `<div class="soft-panel success-panel">${escapeHtml(state.notice)}</div>`;
}

function renderSexOptions(value) {
  const options = ["Masculino", "Femenino", "Otro / no especificado"];
  return [`<option value="">Seleccionar</option>`]
    .concat(
      options.map(
        (option) => `<option value="${escapeHtml(option)}" ${value === option ? "selected" : ""}>${escapeHtml(option)}</option>`
      )
    )
    .join("");
}

function formatDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-PE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-PE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatCoverage(value) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function toggleTableSort(tableIndex, columnIndex, table) {
  const current = state.tableSorts[tableIndex];
  const nextDirection =
    current?.column === columnIndex
      ? current.direction === "desc"
        ? "asc"
        : "desc"
      : inferDefaultSortDirection(table.columns[columnIndex], table.rows, columnIndex);

  state.tableSorts = {
    ...state.tableSorts,
    [tableIndex]: {
      column: columnIndex,
      direction: nextDirection,
    },
  };
  render();
}

function getSortedTable(table, tableIndex) {
  const activeSort = state.tableSorts[tableIndex];
  if (!activeSort) {
    return table;
  }

  const rows = [...table.rows].sort((left, right) =>
    compareTableCells(left[activeSort.column], right[activeSort.column], activeSort.direction)
  );

  return {
    ...table,
    rows,
  };
}

function compareTableCells(left, right, direction) {
  const multiplier = direction === "desc" ? -1 : 1;
  const leftNumber = extractNumericValue(left);
  const rightNumber = extractNumericValue(right);

  if (leftNumber !== null && rightNumber !== null) {
    return (leftNumber - rightNumber) * multiplier;
  }

  return String(left).localeCompare(String(right), "es", {
    numeric: true,
    sensitivity: "base",
  }) * multiplier;
}

function extractNumericValue(value) {
  if (typeof value === "number") {
    return value;
  }

  const text = String(value).trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }

  return null;
}

function inferDefaultSortDirection(columnLabel, rows, columnIndex) {
  const normalized = String(columnLabel).toLowerCase();
  if (/(puntaje|score|z|total|promedio|media|frecuencia|malestar|riesgo|percent|suma)/.test(normalized)) {
    return "desc";
  }

  const numericRows = rows.filter((row) => extractNumericValue(row[columnIndex]) !== null).length;
  if (numericRows && numericRows === rows.length) {
    return "desc";
  }

  return "asc";
}
