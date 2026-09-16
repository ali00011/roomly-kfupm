const DATA_URL = './data/course-offerings-261.json';
const AUTO_REFRESH_MS = 15 * 60 * 1000;
const THEME_STORAGE_KEY = 'roomly-theme';

const dayNames = { U: 'Sunday', M: 'Monday', T: 'Tuesday', W: 'Wednesday', R: 'Thursday' };

const state = {
  selectedDay: 'M',
  entryTime: '10:00',
  exitTime: '11:00',
  selectedBuilding: '24',
  buildingQuery: '',
  data: null,
};

const elements = {
  dayOptions: [...document.querySelectorAll('.day-option')],
  buildingGrid: document.querySelector('#building-grid'),
  buildingSearch: document.querySelector('#building-search'),
  buildingCount: document.querySelector('#building-count'),
  entryTime: document.querySelector('#entry-time'),
  exitTime: document.querySelector('#exit-time'),
  timeSummary: document.querySelector('#time-summary-text'),
  resultsGrid: document.querySelector('#results-grid'),
  emptyState: document.querySelector('#empty-state'),
  resultCount: document.querySelector('#result-count'),
  resultsSubtitle: document.querySelector('#results-subtitle'),
  dataStatus: document.querySelector('#data-status'),
  reset: document.querySelector('#reset-button'),
  refresh: document.querySelector('#refresh-button'),
  themeToggle: document.querySelector('#theme-toggle'),
  themeIcon: document.querySelector('#theme-icon'),
  themeLabel: document.querySelector('#theme-label'),
};

const timeOptions = [];
for (let minutes = 7 * 60; minutes <= 22 * 60; minutes += 30) {
  timeOptions.push(minutesToTime(minutes));
}

function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function timeToMinutes(value) {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return Number.NaN;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function formatTime(value) {
  const totalMinutes = timeToMinutes(value);
  const rawHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const suffix = rawHours >= 12 ? 'PM' : 'AM';
  const hours = rawHours % 12 || 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function parseDays(rawDays) {
  return String(rawDays).toUpperCase().match(/[UMTWR]/g) || [];
}

function isUsableRoomNumber(value) {
  const room = String(value ?? '').trim();
  if (!room || /^(none|null|undefined|n\/?a|tba|online|virtual|-)$/i.test(room)) return false;
  return /\d/.test(room);
}

function parseLocation(location) {
  const match = String(location).trim().match(/^(\d+)\s*-\s*([A-Za-z0-9-]+)$/);
  if (!match || !isUsableRoomNumber(match[2])) return { building: '', room: '' };
  return { building: match[1], room: match[2] };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function isOverlapping(offering, selectedDay, requestedStart, requestedEnd) {
  if (!parseDays(offering.days).includes(selectedDay)) return false;
  const classStart = timeToMinutes(offering.start);
  const classEnd = timeToMinutes(offering.end);
  if (!Number.isFinite(classStart) || !Number.isFinite(classEnd)) return false;
  return classStart < requestedEnd && classEnd > requestedStart;
}

function getBuildingNumbers() {
  if (!state.data) return [];
  const buildingNumbers = new Set();
  state.data.rooms.forEach((room) => {
    if (room.building && isUsableRoomNumber(room.room)) buildingNumbers.add(String(room.building));
  });
  state.data.offerings.forEach((offering) => {
    const { building } = parseLocation(offering.location);
    if (building) buildingNumbers.add(building);
  });
  return [...buildingNumbers].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

function getFilteredBuildingNumbers() {
  const query = state.buildingQuery.trim();
  if (!query) return getBuildingNumbers();
  return getBuildingNumbers().filter((building) => building.includes(query));
}

function ensureValidSelections() {
  const buildings = getBuildingNumbers();
  if (!buildings.includes(state.selectedBuilding)) state.selectedBuilding = buildings[0] || '';
  if (timeToMinutes(state.exitTime) <= timeToMinutes(state.entryTime)) {
    state.exitTime = timeOptions.find((time) => timeToMinutes(time) > timeToMinutes(state.entryTime)) || timeOptions.at(-1);
  }
}

function renderTimeOptions() {
  const selectedEntry = state.entryTime;
  const validExitOptions = timeOptions.filter((time) => timeToMinutes(time) > timeToMinutes(selectedEntry));
  elements.entryTime.innerHTML = timeOptions.map((time) => `<option value="${time}">${formatTime(time)}</option>`).join('');
  elements.exitTime.innerHTML = validExitOptions.map((time) => `<option value="${time}">${formatTime(time)}</option>`).join('');
  elements.entryTime.value = state.entryTime;
  elements.exitTime.value = state.exitTime;
}

function renderBuildingOptions() {
  const allBuildings = getBuildingNumbers();
  const buildings = getFilteredBuildingNumbers();
  elements.buildingCount.textContent = state.buildingQuery.trim()
    ? `${buildings.length} of ${allBuildings.length} buildings`
    : `${allBuildings.length} buildings`;
  if (!buildings.length) {
    elements.buildingGrid.innerHTML = '<p class="building-no-results">No matching building number.</p>';
    return;
  }
  elements.buildingGrid.innerHTML = buildings.map((building) => {
    const selected = building === state.selectedBuilding;
    return `<button type="button" class="building-option${selected ? ' selected' : ''}" data-building="${escapeHtml(building)}" role="radio" aria-checked="${selected}" aria-label="Building ${escapeHtml(building)}">
      <span class="building-icon">${escapeHtml(building)}</span>
    </button>`;
  }).join('');
}

function getAvailableRooms() {
  if (!state.data || !state.selectedBuilding) return [];
  const requestedStart = timeToMinutes(state.entryTime);
  const requestedEnd = timeToMinutes(state.exitTime);
  if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd) || requestedEnd <= requestedStart) return [];

  return state.data.rooms
    .filter((room) => String(room.building) === state.selectedBuilding)
    .filter((room) => isUsableRoomNumber(room.room))
    .filter((room) => {
      const roomLocation = `${room.building}-${room.room}`;
      return !state.data.offerings.some((offering) => {
        const offeringLocation = parseLocation(offering.location);
        return `${offeringLocation.building}-${offeringLocation.room}` === roomLocation
          && isOverlapping(offering, state.selectedDay, requestedStart, requestedEnd);
      });
    })
    .sort((a, b) => Number(a.room) - Number(b.room) || String(a.room).localeCompare(String(b.room)));
}

function renderControls() {
  ensureValidSelections();
  elements.dayOptions.forEach((button) => {
    const selected = button.dataset.day === state.selectedDay;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  renderTimeOptions();
  renderBuildingOptions();
  if (elements.buildingSearch.value !== state.buildingQuery) elements.buildingSearch.value = state.buildingQuery;
  elements.timeSummary.textContent = `${dayNames[state.selectedDay]} · ${formatTime(state.entryTime)} — ${formatTime(state.exitTime)}`;
}

function renderRoomCard(room) {
  const building = escapeHtml(room.building);
  const roomNumber = escapeHtml(room.room);
  return `<article class="room-card">
    <div>
      <div class="room-card-top"><span class="room-type">${escapeHtml(room.type || 'Classroom')}</span><span class="room-status"><span class="status-dot"></span> Free</span></div>
      <div class="room-number">${building} — ${roomNumber}</div>
      <div class="room-building">Building ${building}</div>
    </div>
    <div class="room-card-bottom"><span class="room-meta">FULL WINDOW</span><span class="room-capacity">Up to ${escapeHtml(room.capacity || '—')}</span></div>
  </article>`;
}

function renderResults() {
  const rooms = getAvailableRooms();
  elements.resultsGrid.innerHTML = rooms.map(renderRoomCard).join('');
  elements.resultsGrid.hidden = rooms.length === 0;
  elements.emptyState.hidden = rooms.length !== 0;
  elements.resultCount.textContent = `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}`;
  elements.resultsSubtitle.textContent = `${dayNames[state.selectedDay]} · ${formatTime(state.entryTime)}–${formatTime(state.exitTime)} · Building ${state.selectedBuilding || '—'}`;
}

function render() {
  renderControls();
  renderResults();
}

function updateDataStatus(data) {
  if (data.mode === 'preview') {
    elements.dataStatus.textContent = 'TERM 261 preview data';
    elements.dataStatus.title = 'Preview data — run the TERM 261 sync before publishing.';
    return;
  }

  const updatedAt = new Date(data.fetchedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    elements.dataStatus.textContent = 'TERM 261 data synced';
    elements.dataStatus.title = '';
    return;
  }

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(updatedAt);
  elements.dataStatus.textContent = `TERM 261 · Updated ${formattedDate}`;
  elements.dataStatus.title = `Last successful data sync: ${updatedAt.toISOString()}`;
}

function sanitizeData(data) {
  const rooms = (Array.isArray(data.rooms) ? data.rooms : []).filter((room) => (
    /^\d+$/.test(String(room.building ?? '').trim()) && isUsableRoomNumber(room.room)
  ));
  const offerings = (Array.isArray(data.offerings) ? data.offerings : []).filter((offering) => {
    const location = parseLocation(offering.location);
    return Boolean(location.building && location.room);
  });
  return { ...data, rooms, offerings };
}

async function loadData({ silent = false } = {}) {
  const previousData = state.data;
  if (!silent || !previousData) elements.dataStatus.textContent = 'Loading TERM 261 data…';
  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const nextData = await response.json();
    if (String(nextData.term) !== '261') throw new Error('Only TERM 261 is supported.');
    state.data = sanitizeData(nextData);
    updateDataStatus(state.data);
  } catch (error) {
    console.error(error);
    if (!previousData) {
      state.data = { rooms: [], offerings: [] };
      elements.dataStatus.textContent = 'Data unavailable — refresh to retry';
    } else {
      state.data = previousData;
      elements.dataStatus.textContent = 'Using last data · refresh failed';
      elements.dataStatus.title = 'The latest refresh failed; the previous data is still shown.';
    }
  }
  render();
}

elements.dayOptions.forEach((button) => {
  button.addEventListener('click', () => {
    state.selectedDay = button.dataset.day;
    render();
  });
});

elements.buildingGrid.addEventListener('click', (event) => {
  const button = event.target.closest('.building-option');
  if (!button) return;
  state.selectedBuilding = button.dataset.building;
  render();
});

elements.buildingSearch.addEventListener('input', (event) => {
  state.buildingQuery = event.target.value.replace(/\D/g, '');
  const matches = getFilteredBuildingNumbers();
  if (matches.length && !matches.includes(state.selectedBuilding)) state.selectedBuilding = matches[0];
  render();
});

elements.entryTime.addEventListener('change', (event) => {
  state.entryTime = event.target.value;
  render();
});

elements.exitTime.addEventListener('change', (event) => {
  state.exitTime = event.target.value;
  render();
});

elements.reset.addEventListener('click', () => {
  state.selectedDay = 'M';
  state.entryTime = '10:00';
  state.exitTime = '11:00';
  state.selectedBuilding = '24';
  state.buildingQuery = '';
  render();
});

elements.refresh.addEventListener('click', async () => {
  elements.refresh.classList.add('is-refreshing');
  await loadData();
  window.setTimeout(() => elements.refresh.classList.remove('is-refreshing'), 300);
});

window.setInterval(() => {
  if (document.visibilityState === 'visible') loadData({ silent: true });
}, AUTO_REFRESH_MS);

function getStoredTheme() {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
  } catch (error) {
    console.warn('Theme preference could not be read.', error);
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = theme;
  elements.themeToggle.setAttribute('aria-pressed', String(isDark));
  elements.themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  elements.themeIcon.textContent = isDark ? '☀' : '☾';
  elements.themeLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
}

elements.themeToggle.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (error) {
    console.warn('Theme preference could not be saved.', error);
  }
  applyTheme(nextTheme);
});

applyTheme(getStoredTheme());

loadData();
