// Connexion à Firebase : liste partagée en direct, comptes Google, admin et bannissements.
// Ces informations identifient le projet Firebase, elles ne sont pas secrètes :
// la sécurité est assurée par les règles de la base (voir database.rules.json).
const firebaseConfig = {
  apiKey: 'AIzaSyBiT-5zi4HRJodTMoZNpKDzENRsEezdS7o',
  authDomain: 'presence-poker.firebaseapp.com',
  databaseURL: 'https://presence-poker-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'presence-poker',
  storageBucket: 'presence-poker.firebasestorage.app',
  messagingSenderId: '224064261877',
  appId: '1:224064261877:web:02d69ffd1138cc56807fbc',
};

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

/**
 * handlers : {
 *   onPlayers(obj), onSeating(data|null), onConnection(bool), onError(err),
 *   onAuth({ user, isAdmin }), onUsers(obj)
 * }
 */
export async function initCloud(handlers) {
  const [{ initializeApp }, db$, auth$] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-database.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);
  const { getDatabase, ref, onValue, set, get, update } = db$;
  const {
    getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
    getRedirectResult, signOut, onAuthStateChanged,
  } = auth$;

  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  onValue(ref(db, 'players'), snap => handlers.onPlayers(snap.val() || {}), err => handlers.onError(err));
  onValue(ref(db, 'seating'), snap => handlers.onSeating(snap.val()), () => {});
  onValue(ref(db, '.info/connected'), snap => handlers.onConnection(snap.val() === true));

  let unsubs = [];
  const stopUserListeners = () => {
    unsubs.forEach(u => u());
    unsubs = [];
  };

  onAuthStateChanged(auth, async user => {
    stopUserListeners();
    if (!user) {
      return handlers.onAuth({ user: null, isAdmin: false });
    }

    // Fiche du joueur (nom + photo Google), visible par l'admin
    set(ref(db, `users/${user.uid}`), {
      name: (user.displayName || 'Sans nom').slice(0, 60),
      photo: (user.photoURL || '').slice(0, 1000),
      lastSeen: Date.now(),
    }).catch(() => {});

    let isAdmin = false;
    try {
      isAdmin = (await get(ref(db, `admins/${user.uid}`))).val() === true;
    } catch {
      isAdmin = false;
    }
    if (isAdmin) {
      unsubs.push(onValue(ref(db, 'users'), s => handlers.onUsers(s.val() || {}), () => {}));
    }
    handlers.onAuth({ user, isAdmin });
  });

  getRedirectResult(auth).catch(() => {});

  return {
    async signIn() {
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
          await signInWithRedirect(auth, provider);
        } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
          throw err;
        }
      }
    },
    signOut: () => signOut(auth),
    // updates : { idJoueur: {...} | null }
    updatePlayers: updates => update(ref(db, 'players'), updates),
    setPlayer: (id, data) => set(ref(db, `players/${id}`), data),
    // Retire le compte : sa ligne dans la liste et sa fiche. Il pourra se reconnecter plus tard.
    removeAccount: uid => update(ref(db), { [`players/${uid}`]: null, [`users/${uid}`]: null }),
    setSeating: data => set(ref(db, 'seating'), data),
  };
}
