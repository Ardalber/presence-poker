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

// Dernière liste reçue du serveur, pour l'afficher tout de suite (et hors connexion)
const CACHE_KEY = 'pokerSharedCache';
function loadCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return data && Array.isArray(data.players) ? data : null;
  } catch {
    return null;
  }
}

const cache = loadCache();
const localPlayers = loadPlayers(); // ancienne liste propre à cet appareil (pour l'import admin)
let players = cache ? cache.players.map(normalizePlayer) : [];
let seatingData = cache ? cache.seating : null;
let filter = 'all';

let cloud = null;       // API Firebase une fois chargée
let isAdmin = false;
let currentUser = null;
let cloudLoaded = false; // la liste du serveur a été reçue au moins une fois

const canEdit = () => isAdmin && cloud !== null;

function writeCache() {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ players, seating: seatingData }));
}

// Enregistre la liste sur le serveur : tous les appareils la voient en direct
function save() {
  if (!canEdit()) return;
  writeCache();
  cloud.setPlayers(players).catch(err => {
    console.error(err);
    showToast('Modification refusée par le serveur');
  });
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
    ? (!cloudLoaded ? 'Chargement de la liste…'
      : canEdit() ? 'Aucun joueur pour l’instant. Ajoute le premier !'
      : 'Aucun joueur pour l’instant.')
    : 'Aucun joueur dans cette catégorie.';

  updateSummary();
  checkSeatingStale();
}

function buildItem(p, i, state) {
  const li = document.createElement('li');
  li.className = 'player-item';
  li.draggable = canEdit();
  li.dataset.index = i;
  li.dataset.playerState = state;
  if (canEdit()) li.title = 'Clique pour changer le statut';

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

  if (canEdit()) li.append(avatar, info, tools, toggles);
  else li.append(avatar, info);

  li.addEventListener('click', e => {
    if (!canEdit() || e.target.closest('button, input')) return;
    const next = STATES[(STATES.indexOf(state) + 1) % STATES.length];
    setState(i, next);
  });

  if (canEdit()) setupDrag(li);
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
  if (!canEdit()) return;
  players[i].presence = VALUE_OF[state];
  save();
  render();
}

function addPlayer(name) {
  if (!canEdit()) return;
  players.push({ name, presence: 0 });
  save();
  render();
}

let lastRemoved = null;
function removePlayer(i) {
  if (!canEdit()) return;
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
  if (!canEdit()) return;
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
  if (!canEdit()) return;
  players =players.map(p => ({ ...p, presence: 0 }));
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
    if (!canEdit() || dragIndex === null || target === dragIndex) return;
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

// Tirage fait par l'admin, puis partagé : tout le monde voit le même plan de table
function drawSeating() {
  if (!canEdit()) return;
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
  const data = {
    tables,
    dealers: tables.map(seats => Math.floor(Math.random() * seats.length)),
    at: Date.now(),
  };
  seatingClosedAt = null;
  showSeating(data, true);
  cloud.setSeating(data).catch(() => showToast('Plan de table non partagé'));
}

let seatingClosedAt = null; // plan masqué par l'utilisateur sur cet appareil

function showSeating(data, scroll = false) {
  seatingData = data;
  const tablesData = data && Array.isArray(data.tables) ? data.tables.map(t => Object.values(t || {})) : [];
  if (tablesData.length === 0 || seatingClosedAt === data.at) {
    seatingEl.classList.add('hidden');
    lastSeatedKey = null;
    return;
  }
  const container = document.getElementById('tables');
  container.innerHTML = '';
  const dealers = data.dealers ? Object.values(data.dealers) : [];
  tablesData.forEach((seats, t) => container.append(buildTable(seats, t, tablesData.length, dealers[t] ?? 0)));

  lastSeatedKey = tablesData.flat().sort().join('|');
  seatingEl.classList.remove('hidden');
  checkSeatingStale();
  if (scroll) seatingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildTable(seats, t, total, dealer) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';

  if (total > 1) {
    const title = document.createElement('h3');
    title.textContent = `Table ${t + 1}`;
    wrap.append(title);
  }

  const felt = document.createElement('div');
  felt.className = 'felt';

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
  seatingClosedAt = seatingData ? seatingData.at : null;
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

/* ---------- Liste partagée en direct (Firebase) ---------- */

const adminBtn = document.getElementById('admin-btn');
const statusEl = document.getElementById('live-status');
const uidBox = document.getElementById('uid-box');

function applyMode() {
  document.body.classList.toggle('is-admin', canEdit());
  document.body.classList.toggle('readonly', !canEdit());
  if (!cloud) {
    adminBtn.textContent = '🔒 Admin';
    adminBtn.disabled = true;
  } else if (canEdit()) {
    adminBtn.textContent = '👑 Admin · Déconnexion';
    adminBtn.disabled = false;
  } else if (currentUser) {
    adminBtn.textContent = 'Déconnexion';
    adminBtn.disabled = false;
  } else {
    adminBtn.textContent = '🔒 Admin';
    adminBtn.disabled = false;
  }
  uidBox.classList.toggle('hidden', !(currentUser && !isAdmin));
  if (currentUser && !isAdmin) document.getElementById('uid-value').textContent = currentUser.uid;
  render();
  showSeating(seatingData);
}

function setStatus(online) {
  statusEl.dataset.online = String(online);
  statusEl.textContent = online ? 'En direct' : 'Hors ligne';
}

adminBtn.addEventListener('click', async () => {
  if (!cloud) return;
  try {
    if (currentUser) await cloud.signOut();
    else await cloud.signIn();
  } catch (err) {
    console.error(err);
    const messages = {
      'auth/unauthorized-domain': 'Connexion bloquée : ajoute ce site dans les domaines autorisés de Firebase',
      'auth/network-request-failed': 'Connexion impossible : pas de réseau',
    };
    showToast(messages[err.code] || 'Connexion impossible : ' + (err.code || err.message));
  }
});

document.getElementById('uid-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentUser.uid);
    showToast('Identifiant copié');
  } catch {
    showToast(currentUser.uid);
  }
});

let importOffered = false;
function offerImport() {
  // Première connexion admin : si le serveur est vide, on reprend la liste de cet appareil
  if (importOffered || !canEdit() || !cloudLoaded || players.length > 0 || localPlayers.length === 0) return;
  importOffered = true;
  players = localPlayers.map(p => ({ ...p }));
  save();
  render();
  showToast(`${players.length} joueurs repris de cet appareil et partagés`);
}

async function startCloud() {
  try {
    const { initCloud } = await import('./cloud.js');
    cloud = await initCloud({
      onPlayers(list) {
        players = list.map(normalizePlayer).filter(p => p.name);
        cloudLoaded = true;
        writeCache();
        render();
        offerImport();
      },
      onSeating(data) {
        showSeating(data);
        writeCache();
      },
      onConnection: setStatus,
      onError(err) {
        console.error(err);
        cloudLoaded = true;
        render();
        showToast('Lecture de la liste refusée : règles Firebase à publier');
      },
      onAuth({ user, isAdmin: admin }) {
        const wasAdmin = isAdmin;
        currentUser = user;
        isAdmin = admin;
        applyMode();
        if (admin && !wasAdmin) showToast('Mode admin : tes modifications sont visibles en direct');
        if (user && !admin) showToast('Ce compte n’est pas administrateur');
        offerImport();
      },
    });
    applyMode();
  } catch (err) {
    console.error(err);
    cloudLoaded = true;
    setStatus(false);
    applyMode();
    showToast('Hors ligne : affichage de la dernière liste connue');
  }
}

setStatus(false);
applyMode();
startCloud();

/* Appli installable : fonctionne aussi hors connexion */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- Premier lancement : installer ou rester dans le navigateur ---------- */

const CHOICE_KEY = 'pokerInstallChoice';
const sheet = document.getElementById('install-sheet');
const installBtn = document.getElementById('install-btn');
const stepsEl = document.getElementById('install-steps');
let deferredPrompt = null;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = isIOS || /Android|Mobile/i.test(ua);

function installSteps() {
  if (isIOS) {
    const inSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
    return (inSafari ? '' : '<p>Sur iPhone, ouvre d\'abord ce lien dans <b>Safari</b>.</p>') +
      '<ol><li>Appuie sur <b>Partager</b> <span aria-hidden="true">⎋</span> en bas de l\'écran</li>' +
      '<li>Choisis <b>« Sur l\'écran d\'accueil »</b></li><li>Appuie sur <b>Ajouter</b></li></ol>';
  }
  if (/Android/i.test(ua)) {
    return '<ol><li>Ouvre le menu du navigateur <b>⋮</b></li>' +
      '<li>Choisis <b>« Installer l\'application »</b> ou <b>« Ajouter à l\'écran d\'accueil »</b></li></ol>';
  }
  return '<p>Dans la barre d\'adresse, clique sur l\'icône <b>Installer</b> (⊕), ou passe par le menu du navigateur.</p>';
}

function openSheet() {
  if (isStandalone()) {
    installBtn.classList.add('hidden');
  } else {
    installBtn.classList.remove('hidden');
  }
  stepsEl.classList.add('hidden');
  sheet.classList.remove('hidden');
}

function closeSheet(choice) {
  sheet.classList.add('hidden');
  if (choice) localStorage.setItem(CHOICE_KEY, choice);
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); // on affiche notre propre choix
  deferredPrompt = e;
});

window.addEventListener('appinstalled', () => {
  closeSheet('installed');
  showToast('Appli installée sur ton écran d\'accueil 🎉');
});

installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') closeSheet('installed');
    return;
  }
  stepsEl.innerHTML = installSteps();
  stepsEl.classList.remove('hidden');
});

document.getElementById('browser-btn').addEventListener('click', () => closeSheet('browser'));

document.getElementById('share-btn').addEventListener('click', async () => {
  const url = location.origin + location.pathname;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Présence Poker', text: 'Qui est à la table ce soir ?', url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Lien copié : colle-le dans le navigateur ou l\'appli de ton choix');
  } catch {
    showToast(url);
  }
});

sheet.addEventListener('click', e => {
  if (e.target === sheet) closeSheet('browser');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !sheet.classList.contains('hidden')) closeSheet('browser');
});
document.getElementById('open-install').addEventListener('click', openSheet);

// Proposé automatiquement au premier passage sur téléphone, sauf dans l'appli installée
if (!isStandalone() && isMobile && !localStorage.getItem(CHOICE_KEY)) {
  setTimeout(openSheet, 600);
}
