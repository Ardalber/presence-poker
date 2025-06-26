const STORAGE_KEY = 'pokerPlayers';

function loadPlayers() {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}
function savePlayers(players) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}
function updateSummary(players) {
  const count = players.filter(p => p.present).length;
  document.getElementById('present-count').textContent = count;
}
function renderList() {
  const ul = document.getElementById('player-list');
  ul.innerHTML = '';
  const players = loadPlayers();

  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'player-item';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;
    nameSpan.className = 'player-name';

    const label = document.createElement('label');
    label.className = 'switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = p.present;
    cb.addEventListener('change', () => {
      players[i].present = cb.checked;
      savePlayers(players);
      updateSummary(players);
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    label.append(cb, slider);

    const controls = document.createElement('div');
    controls.className = 'player-controls';

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

    controls.append(renameBtn, deleteBtn);
    li.append(nameSpan, label, controls);
    ul.append(li);
  });

  updateSummary(loadPlayers());
}

document.getElementById('player-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('player-name').value.trim();
  if (!name) return;
  const players = loadPlayers();
  players.push({ name, present: false });
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
  const players = loadPlayers().map(p => ({ ...p, present: false }));
  savePlayers(players);
  renderList();
  confirmBox.classList.add('hidden');
});
noBtn.addEventListener('click', () => {
  confirmBox.classList.add('hidden');
});

document.addEventListener('DOMContentLoaded', renderList);
