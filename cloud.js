// Connexion à Firebase : liste partagée en direct + connexion admin Google.
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
 * handlers : { onPlayers(list), onSeating(data|null), onAuth({ user, isAdmin }), onConnection(bool) }
 */
export async function initCloud(handlers) {
  const [{ initializeApp }, db$, auth$] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-database.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);
  const { getDatabase, ref, onValue, set, get } = db$;
  const {
    getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
    getRedirectResult, signOut, onAuthStateChanged,
  } = auth$;

  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const toList = v => (Array.isArray(v) ? v : v ? Object.values(v) : []).filter(Boolean);

  onValue(ref(db, 'players'), snap => handlers.onPlayers(toList(snap.val())), err => handlers.onError(err));
  onValue(ref(db, 'seating'), snap => handlers.onSeating(snap.val()), () => {});
  onValue(ref(db, '.info/connected'), snap => handlers.onConnection(snap.val() === true));

  onAuthStateChanged(auth, async user => {
    if (!user) return handlers.onAuth({ user: null, isAdmin: false });
    let isAdmin = false;
    try {
      isAdmin = (await get(ref(db, `admins/${user.uid}`))).val() === true;
    } catch {
      isAdmin = false;
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
    setPlayers: list => set(ref(db, 'players'), list),
    setSeating: data => set(ref(db, 'seating'), data),
  };
}
