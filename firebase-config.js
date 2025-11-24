// Firebase Configuration
// Replace these values with your Firebase project configuration
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
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
