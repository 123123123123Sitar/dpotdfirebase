// Firebase Configuration
// Replace these values with your Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyDKUKsa5G321pwX8JCkAnpvYcig33ripEo",
  authDomain: "dpotd-app.firebaseapp.com",
  projectId: "dpotd-app",
  storageBucket: "dpotd-app.firebasestorage.app",
  messagingSenderId: "756829711322",
  appId: "1:756829711322:web:46bc121c55810cbf9f6ee3"
};


// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firestore
const db = firebase.firestore();

// Initialize Auth
const auth = firebase.auth();

// Helper function to get current user
function getCurrentUser() {
  return auth.currentUser;
}

// Helper function to get user document
async function getUserDoc(userId) {
  try {
    const doc = await db.collection('users').doc(userId).get();
    if (doc.exists) {
      return doc.data();
    }
    return null;
  } catch (error) {
    console.error('Error getting user document:', error);
    return null;
  }
}

// Helper function to check if user is admin
async function isUserAdmin(userId) {
  const userDoc = await getUserDoc(userId);
  return userDoc && userDoc.isAdmin === true;
}
