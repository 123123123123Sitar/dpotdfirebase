const appAuth = firebase.auth();
const firestore = firebase.firestore();

// Timer state
let timeRemaining = 0;
let totalTime = 0;
let timerInterval = null;
let isRunning = false;
let fiveMinuteWarningShown = false;
let currentTest = '';

// Clarifications storage
let clarifications = [];

// DOM elements
const testTypeSelect = document.getElementById('testType');
const timerDisplay = document.getElementById('timerDisplay');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const mainContainer = document.getElementById('mainContainer');
const clarificationsList = document.getElementById('clarificationsList');
const roundName = document.getElementById('roundName');
const clarificationForm = document.getElementById('clarificationForm');

// Load clarifications from Firebase on page load
async function loadClarificationsFromFirestore() {
    try {
        const snapshot = await firebase.firestore().collection('DTMTClarifications').orderBy('timestamp', 'desc').get();
        clarifications = [];
        snapshot.forEach(doc => {
            clarifications.push({
                id: doc.id,
                ...doc.data()
            });
        });
        displayClarifications();
    } catch (error) {
        // ...existing code...
    }
}

// Listen for real-time updates from Firestore
firebase.firestore().collection('DTMTClarifications').orderBy('timestamp', 'desc').onSnapshot((snapshot) => {
    clarifications = [];
    snapshot.forEach(doc => {
        clarifications.push({
            id: doc.id,
            ...doc.data()
        });
    });
    displayClarifications();
});

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

// Test type selection
testTypeSelect.addEventListener('change', (e) => {
    const minutes = parseInt(e.target.value);
    if (minutes) {
        currentTest = e.target.options[e.target.selectedIndex].text;
        totalTime = minutes * 60;
        timeRemaining = totalTime;
        updateDisplay();
        displayClarifications();
        roundName.textContent = currentTest;
        startBtn.disabled = false;
        fiveMinuteWarningShown = false;
    }
});

// Format time display
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Update display
function updateDisplay() {
    timerDisplay.textContent = formatTime(timeRemaining);
    
    if (timeRemaining <= 300 && timeRemaining > 0) {
        timerDisplay.classList.add('warning');
        if (!fiveMinuteWarningShown && timeRemaining === 300) {
            playWarningSound();
            fiveMinuteWarningShown = true;
        }
    } else {
        timerDisplay.classList.remove('warning');
    }
}

// Play warning sound (simple beep)
function playWarningSound() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
}

// Play alarm sound
function playAlarmSound() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    for (let i = 0; i < 3; i++) {
        setTimeout(() => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 1000;
            oscillator.type = 'square';
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        }, i * 400);
    }
}

// Start timer
startBtn.addEventListener('click', () => {
    if (timeRemaining > 0) {
        isRunning = true;
        startBtn.disabled = true;
        pauseBtn.disabled = false;
        testTypeSelect.disabled = true;
        
        timerInterval = setInterval(() => {
            timeRemaining--;
            updateDisplay();
            
            if (timeRemaining <= 0) {
                clearInterval(timerInterval);
                isRunning = false;
                playAlarmSound();
                pauseBtn.disabled = true;
            }
        }, 1000);
    }
});

// Pause timer
pauseBtn.addEventListener('click', () => {
    if (isRunning) {
        clearInterval(timerInterval);
        isRunning = false;
        startBtn.disabled = false;
        pauseBtn.disabled = true;
    }
});

// Reset timer
resetBtn.addEventListener('click', () => {
    clearInterval(timerInterval);
    isRunning = false;
    timeRemaining = totalTime;
    updateDisplay();
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    testTypeSelect.disabled = false;
    fiveMinuteWarningShown = false;
});

// Fullscreen
fullscreenBtn.addEventListener('click', () => {
    if (mainContainer.classList.contains('fullscreen-mode')) {
        mainContainer.classList.remove('fullscreen-mode');
        fullscreenBtn.textContent = 'Fullscreen';
        document.exitFullscreen();
    } else {
        mainContainer.classList.add('fullscreen-mode');
        fullscreenBtn.textContent = 'Exit Fullscreen';
        document.documentElement.requestFullscreen();
    }
});

// Clarification form submission
clarificationForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const clarification = {
        test: document.getElementById('clarTest').value,
        question: document.getElementById('clarQuestion').value,
        text: document.getElementById('clarText').value,
        timestamp: new Date()
    };
    
    try {
        await firebase.firestore().collection('DTMTClarifications').add(clarification);
        clarificationForm.reset();
        document.querySelector('[data-tab="timer"]').click();
    } catch (error) {
        // ...existing code...
        alert('Failed to save clarification. Please try again.');
    }
});

// Display clarifications
function displayClarifications() {
    const filteredClarifications = currentTest 
        ? clarifications.filter(c => {
            const testName = currentTest.replace(/\s*\(\d+\s*min\)/, '');
            return c.test === testName;
        })
        : clarifications;

    if (filteredClarifications.length === 0) {
        clarificationsList.innerHTML = '<div class="no-clarifications">No clarifications posted yet.</div>';
        return;
    }
    
    clarificationsList.innerHTML = filteredClarifications
        .map(c => `
            <div class="clarification-item">
                <div class="question">${c.question}</div>
                <div class="text">${c.text}</div>
            </div>
        `).join('');
}

// Initialize
loadClarificationsFromFirestore();
updateDisplay();