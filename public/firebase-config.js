// firebase-config.js

// Your Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyDKUKsa5G321pwX8JCkAnpvYcig33ripEo",
    authDomain: "dpotd-app.firebaseapp.com",
    projectId: "dpotd-app",
    storageBucket: "dpotd-app.appspot.com",
    messagingSenderId: "756829711322",
    appId: "1:756829711322:web:46bc121c55810cbf9f6ee3"
};

// Avoid re-initializing in hot reload / multiple imports
if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

// Helper: current signed-in user
function getCurrentUser() {
    return auth.currentUser;
}

// Helper: fetch user document by uid
async function getUserDoc(uid) {
    try {
        const snap = await db.collection("users").doc(uid).get();
        if (!snap.exists) return null;
        return snap.data();
    } catch (err) {
        // ...existing code...
        return null;
    }
}

// Helper: check admin flag on user doc
async function isUserAdmin(uid) {
    const userDoc = await getUserDoc(uid);
    return !!(userDoc && userDoc.isAdmin === true);
}

// Helper: check grader flag on user doc (NEW)
async function isUserGrader(uid) {
    const userDoc = await getUserDoc(uid);
    return !!(userDoc && userDoc.isGrader === true);
}

// Helper: get user role
async function getUserRole(uid) {
    const userDoc = await getUserDoc(uid);
    if (!userDoc) return 'unknown';
    if (userDoc.isAdmin) return 'admin';
    if (userDoc.isGrader) return 'grader';
    return 'student';
}

// Expose globally for HTML scripts
window.db = db;
window.auth = auth;
window.getCurrentUser = getCurrentUser;
window.getUserDoc = getUserDoc;
window.isUserAdmin = isUserAdmin;
window.isUserGrader = isUserGrader;
window.getUserRole = getUserRole;
