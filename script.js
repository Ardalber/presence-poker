const STORAGE_KEY = 'pokerPlayers';
const MAX_PER_TABLE = 9;
const STATES = ['unknown', 'present', 'absent'];
const VALUE_OF = { present: 1, absent: -1, unknown: 0 };

/* ---------- Données ---------- */

function clampPresence(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.max(-1, Math.min(1, num));
}

function normalizePlayer(raw) {
  // Compatible avec l'ancien format (booléen "present")
  const presence =
    typeof raw.presence === 'number'
      ? clampPresence(raw.presence)
      : typeof raw.present === 'boolean'
        ? (raw.present ? 1 : -1)
        : -1;
  return { name: String(raw.name ?? '').trim(), presence };
}

function loadPlayers() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data.map(normalizePlayer).filter(p => p.name) : [];
  } catch {
    return [];
  }
}

let players = loadPlayers();
let filter = 'all';

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}

function stateOf(value) {
  if (value >= 1) return 'present';
  if (value <= -1) return 'absent';
  return 'unknown';
}

function nameExists(name, exceptIndex = -1) {
  const key = name.toLocaleLowerCase('fr');
  return players.some((p, i) => i !== exceptIndex && p.name.toLocaleLowerCase('fr') === key);
}

function initials(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

// Couleur de jeton stable pour chaque nom
const CHIP_COLORS = ['#d6336c', '#1c7ed6', '#f08c00', '#7048e8', '#0ca678', '#e8590c', '#3b5bdb', '#c2255c'];
function chipColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
}

/* ---------- Rendu ---------- */

const listEl = document.getElementById('player-list');
const emptyEl = document.getElementById('empty-state');

function render() {
  listEl.innerHTML = '';

  players.forEach((p, i) => {
    const state = stateOf(p.presence);
    if (filter !== 'all' && filter !== state) return;
    listEl.append(buildItem(p, i, state));
  });

  const visible = listEl.children.length;
  emptyEl.classList.toggle('hidden', visible > 0);
  emptyEl.textContent = players.length === 0
    ? 'Aucun joueur pour l’instant. Ajoute le premier !'
    : 'Aucun joueur dans cette catégorie.';

  updateSummary();
  checkSeatingStale();
}

function buildItem(p, i, state) {
  const li = document.createElement('li');
  li.className = 'player-item';
  li.draggable = true;
  li.dataset.index = i;
  li.dataset.playerState = state;
  li.title = 'Clique pour changer le statut';

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = initials(p.name);
  avatar.style.setProperty('--chip', chipColor(p.name));

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = p.name;

  const badge = document.createElement('span');
  badge.className = 'state-badge';
  badge.textContent = { present: 'Présent', absent: 'Absent', unknown: 'En attente' }[state];

  const info = document.createElement('div');
  info.className = 'player-info';
  info.append(name, badge);

  const toggles = document.createElement('div');
  toggles.className = 'toggle-buttons';
  [
    ['absent', '✕', 'Absent'],
    ['unknown', '?', 'En attente'],
    ['present', '✓', 'Présent'],
  ].forEach(([s, label, title]) => {
    const b = document.createElement('button');
    b.className = `btn-toggle btn-${s}`;
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-pressed', String(s === state));
    b.addEventListener('click', e => {
      e.stopPropagation();
      setState(i, s);
    });
    toggles.append(b);
  });

  const renameBtn = iconButton('✏️', 'Renommer', () => startRename(li, i));
  const deleteBtn = iconButton('🗑️', 'Supprimer', () => removePlayer(i));

  const tools = document.createElement('div');
  tools.className = 'player-tools';
  tools.append(renameBtn, deleteBtn);

  li.append(avatar, info, tools, toggles);

  li.addEventListener('click', e => {
    if (e.target.closest('button, input')) return;
    const next = STATES[(STATES.indexOf(state) + 1) % STATES.length];
    setState(i, next);
  });

  setupDrag(li);
  return li;
}

function iconButton(icon, title, onClick) {
  const b = document.createElement('button');
  b.className = 'btn-icon';
  b.textContent = icon;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', e => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function updateSummary() {
  const counts = { present: 0, absent: 0, unknown: 0 };
  players.forEach(p => counts[stateOf(p.presence)]++);
  bump('present-count', counts.present);
  bump('absent-count', counts.absent);
  bump('unknown-count', counts.unknown);

  const hint = document.getElementById('tables-hint');
  const n = counts.present;
  if (n < 2) {
    hint.textContent = n === 1 ? 'Il faut au moins 2 joueurs pour lancer une partie.' : '';
  } else {
    const tables = Math.ceil(n / MAX_PER_TABLE);
    hint.textContent = tables === 1
      ? `1 table de ${n} joueurs`
      : `${tables} tables (${tableSizes(n).join(' + ')} joueurs)`;
  }
}

function bump(id, value) {
  const el = document.getElementById(id);
  if (el.textContent === String(value)) return;
  el.textContent = value;
  el.classList.remove('bump');
  void el.offsetWidth; // relance l'animation
  el.classList.add('bump');
}

/* ---------- Actions ---------- */

function setState(i, state) {
  players[i].presence = VALUE_OF[state];
  save();
  render();
}

function addPlayer(name) {
  players.push({ name, presence: 0 });
  save();
  render();
}

let lastRemoved = null;
function removePlayer(i) {
  const [removed] = players.splice(i, 1);
  lastRemoved = { player: removed, index: i };
  save();
  render();
  showToast(`${removed.name} supprimé`, 'Annuler', () => {
    if (!lastRemoved) return;
    players.splice(Math.min(lastRemoved.index, players.length), 0, lastRemoved.player);
    lastRemoved = null;
    save();
    render();
  });
}

function startRename(li, i) {
  const nameEl = li.querySelector('.player-name');
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = players[i].name;
  input.maxLength = 30;
  nameEl.replaceWith(input);
  li.draggable = false;
  input.focus();
  input.select();

  let done = false;
  const finish = commit => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (commit && value && value !== players[i].name) {
      if (nameExists(value, i)) {
        showToast(`« ${value} » existe déjà`);
      } else {
        players[i].name = value;
        save();
      }
    }
    render();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', e => e.stopPropagation());
}

document.getElementById('player-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('player-name');
  const errorEl = document.getElementById('form-error');
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  if (nameExists(name)) {
    errorEl.textContent = `« ${name} » est déjà dans la liste.`;
    input.select();
    return;
  }
  errorEl.textContent = '';
  addPlayer(name);
  input.value = '';
  input.focus();
});

document.getElementById('player-name').addEventListener('input', () => {
  document.getElementById('form-error').textContent = '';
});

document.querySelectorAll('.filter').forEach(btn => {
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
});

document.getElementById('sort-btn').addEventListener('click', () => {
  const order = { present: 0, unknown: 1, absent: 2 };
  players.sort((a, b) =>
    order[stateOf(a.presence)] - order[stateOf(b.presence)] ||
    a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  save();
  render();
  showToast('Liste triée : présents d’abord, puis par nom');
});

document.getElementById('copy-btn').addEventListener('click', async () => {
  const present = players.filter(p => stateOf(p.presence) === 'present').map(p => p.name);
  if (present.length === 0) {
    showToast('Aucun présent à copier');
    return;
  }
  const text = `♠ Poker – ${present.length} présent${present.length > 1 ? 's' : ''} :\n` +
    present.map(n => `• ${n}`).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    showToast('Liste des présents copiée');
  } catch {
    showToast('Impossible de copier automatiquement');
  }
});

/* Reset */
const confirmBox = document.getElementById('reset-confirm');
document.getElementById('reset-btn').addEventListener('click', e => {
  e.stopPropagation();
  confirmBox.classList.toggle('hidden');
});
document.getElementById('confirm-yes').addEventListener('click', () => {
  players = players.map(p => ({ ...p, presence: 0 }));
  save();
  render();
  confirmBox.classList.add('hidden');
  showToast('Tout le monde est en attente');
});
document.getElementById('confirm-no').addEventListener('click', () => confirmBox.classList.add('hidden'));
document.addEventListener('click', e => {
  if (!e.target.closest('.reset-wrapper')) confirmBox.classList.add('hidden');
});

/* ---------- Glisser-déposer (insère au lieu d'échanger) ---------- */

let dragIndex = null;

function setupDrag(li) {
  li.addEventListener('dragstart', e => {
    dragIndex = Number(li.dataset.index);
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragIndex));
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    dragIndex = null;
  });
  li.addEventListener('dragover', e => {
    if (dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (Number(li.dataset.index) !== dragIndex) li.classList.add('drop-target');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
  li.addEventListener('drop', e => {
    e.preventDefault();
    const target = Number(li.dataset.index);
    if (dragIndex === null || target === dragIndex) return;
    const [moved] = players.splice(dragIndex, 1);
    players.splice(target, 0, moved);
    save();
    render();
  });
}

/* ---------- Plan de table ---------- */

const seatingEl = document.getElementById('seating');
let lastSeatedKey = null;

function tableSizes(n) {
  const tables = Math.ceil(n / MAX_PER_TABLE);
  const base = Math.floor(n / tables);
  const extra = n % tables;
  return Array.from({ length: tables }, (_, t) => base + (t < extra ? 1 : 0));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function presentKey() {
  return players.filter(p => stateOf(p.presence) === 'present').map(p => p.name).sort().join('|');
}

function drawSeating() {
  const present = players.filter(p => stateOf(p.presence) === 'present').map(p => p.name);
  if (present.length < 2) {
    showToast('Il faut au moins 2 présents pour placer les joueurs');
    return;
  }
  const shuffled = shuffle(present);
  const tables = [];
  let k = 0;
  tableSizes(shuffled.length).forEach(size => {
    tables.push(shuffled.slice(k, k + size));
    k += size;
  });

  const container = document.getElementById('tables');
  container.innerHTML = '';
  tables.forEach((seats, t) => container.append(buildTable(seats, t, tables.length)));

  lastSeatedKey = presentKey();
  seatingEl.classList.remove('hidden');
  checkSeatingStale();
  seatingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildTable(seats, t, total) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';

  if (total > 1) {
    const title = document.createElement('h3');
    title.textContent = `Table ${t + 1}`;
    wrap.append(title);
  }

  const felt = document.createElement('div');
  felt.className = 'felt';
  const dealer = Math.floor(Math.random() * seats.length);

  seats.forEach((name, s) => {
    const angle = (-90 + (360 / seats.length) * s) * Math.PI / 180;
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.style.left = `${50 + 50 * Math.cos(angle)}%`;
    seat.style.top = `${50 + 50 * Math.sin(angle)}%`;
    seat.style.animationDelay = `${s * 60}ms`;

    const num = document.createElement('span');
    num.className = 'seat-num';
    num.textContent = s + 1;
    num.style.setProperty('--chip', chipColor(name));

    const label = document.createElement('span');
    label.className = 'seat-name';
    label.textContent = name;

    seat.append(num, label);
    if (s === dealer) {
      const d = document.createElement('span');
      d.className = 'dealer';
      d.textContent = 'D';
      d.title = 'Donneur';
      seat.append(d);
    }
    felt.append(seat);
  });

  const center = document.createElement('div');
  center.className = 'felt-center';
  center.textContent = `${seats.length} joueurs`;
  felt.append(center);

  wrap.append(felt);
  return wrap;
}

function checkSeatingStale() {
  const stale = !seatingEl.classList.contains('hidden') && lastSeatedKey !== null && lastSeatedKey !== presentKey();
  document.getElementById('seating-stale').classList.toggle('hidden', !stale);
}

document.getElementById('seat-btn').addEventListener('click', drawSeating);
document.getElementById('reseat-btn').addEventListener('click', drawSeating);
document.getElementById('close-seating-btn').addEventListener('click', () => {
  seatingEl.classList.add('hidden');
  lastSeatedKey = null;
});

/* ---------- Notifications ---------- */

let toastTimer = null;
function showToast(text, actionLabel, onAction) {
  const toast = document.getElementById('toast');
  const action = document.getElementById('toast-action');
  document.getElementById('toast-text').textContent = text;

  action.classList.toggle('hidden', !actionLabel);
  action.textContent = actionLabel || '';
  action.onclick = () => {
    onAction?.();
    toast.classList.add('hidden');
  };

  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
    if (actionLabel) lastRemoved = null;
  }, actionLabel ? 5000 : 2500);
}

/* Synchronise si la liste change dans un autre onglet */
window.addEventListener('storage', e => {
  if (e.key === STORAGE_KEY) {
    players = loadPlayers();
    render();
  }
});

render();

/* Appli installable : fonctionne aussi hors connexion */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
