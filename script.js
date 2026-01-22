const STORAGE_KEY = 'pokerPlayers';

function clampPresence(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  if (num > 1) return 1;
  if (num < -1) return -1;
  return num;
}
function normalizePlayer(raw) {
  // Convert legacy boolean "present" to numeric presence, defaulting to absent
  const presence =
    typeof raw.presence === 'number'
      ? clampPresence(raw.presence)
      : typeof raw.present === 'boolean'
        ? (raw.present ? 1 : -1)
        : -1;
  return { name: raw.name, presence };
}
function loadPlayers() {
  const data = localStorage.getItem(STORAGE_KEY);
  const parsed = data ? JSON.parse(data) : [];
  return parsed.map(normalizePlayer);
}
function savePlayers(players) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}
function updateSummary(players) {
  const count = players.filter(p => p.presence === 1).length;
  document.getElementById('present-count').textContent = count;
}
function presenceState(value) {
  if (value >= 1) return 'present';
  if (value <= -1) return 'absent';
  return 'unknown';
}
function applyNameState(el, value) {
  el.className = `player-name ${presenceState(value)}`;
}
function renderList() {
  const ul = document.getElementById('player-list');
  ul.innerHTML = '';
  const players = loadPlayers();

  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'player-item';
    li.draggable = true;
    li.dataset.index = i;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;
    applyNameState(nameSpan, p.presence);

    const toggleWrapper = document.createElement('div');
    toggleWrapper.className = 'tri-toggle';
    toggleWrapper.dataset.state = presenceState(p.presence);

    const range = document.createElement('input');
    range.type = 'range';
    range.min = '-1';
    range.max = '1';
    range.step = '1';
    range.value = p.presence;
    range.className = 'tri-range';
    range.addEventListener('input', () => {
      const value = clampPresence(range.value);
      players[i].presence = value;
      toggleWrapper.dataset.state = presenceState(value);
      applyNameState(nameSpan, value);
      savePlayers(players);
      updateSummary(players);
    });

    toggleWrapper.append(range);

    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏️'; renameBtn.title = 'Renommer';
    renameBtn.addEventListener('click', () => {
      const newName = prompt(`Nouveau nom pour ${p.name}`, p.name);
      if (newName?.trim()) {
        players[i].name = newName.trim();
        savePlayers(players);
        renderList();
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️'; deleteBtn.title = 'Supprimer';
    deleteBtn.addEventListener('click', () => {
      players.splice(i, 1);
      savePlayers(players);
      renderList();
      updateSummary(players);
    });

    const bottomRow = document.createElement('div');
    bottomRow.className = 'player-bottom-row';
    bottomRow.append(renameBtn, toggleWrapper, deleteBtn);
    li.append(nameSpan, bottomRow);
    ul.append(li);
  });

  updateSummary(loadPlayers());
  setupDragAndDrop();
}

document.getElementById('player-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('player-name').value.trim();
  if (!name) return;
  const players = loadPlayers();
  players.push({ name, presence: 0 });
  savePlayers(players);
  document.getElementById('player-name').value = '';
  renderList();
});

const resetBtn = document.getElementById('reset-btn');
const confirmBox = document.getElementById('reset-confirm');
const yesBtn     = document.getElementById('confirm-yes');
const noBtn      = document.getElementById('confirm-no');

resetBtn.addEventListener('click', () => {
  confirmBox.classList.remove('hidden');
});
yesBtn.addEventListener('click', () => {
  const players = loadPlayers().map(p => ({ ...p, presence: 0 }));
  savePlayers(players);
  renderList();
  confirmBox.classList.add('hidden');
});
noBtn.addEventListener('click', () => {
  confirmBox.classList.add('hidden');
});

let draggedItem = null;

function setupDragAndDrop() {
  const playerItems = document.querySelectorAll('.player-item');
  
  playerItems.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      item.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
    });
    
    item.addEventListener('dragend', () => {
      item.style.opacity = '1';
      draggedItem = null;
    });
    
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (item !== draggedItem) {
        item.style.opacity = '0.7';
      }
    });
    
    item.addEventListener('dragleave', () => {
      if (item !== draggedItem) {
        item.style.opacity = '1';
      }
    });
    
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggedItem !== item) {
        const players = loadPlayers();
        const draggedIndex = parseInt(draggedItem.dataset.index);
        const targetIndex = parseInt(item.dataset.index);
        
        [players[draggedIndex], players[targetIndex]] = [players[targetIndex], players[draggedIndex]];
        savePlayers(players);
        renderList();
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', renderList);
