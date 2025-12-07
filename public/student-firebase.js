// D.PotD Student Portal Logic
const appAuth = firebase.auth();
const firestore = firebase.firestore();

// Cache admin emails to filter out admin accounts
async function getAdminEmails() {
    if (window._dpotd_adminEmails) return window._dpotd_adminEmails;
    const set = new Set();
    try {
        const snap = await firestore.collection('users').where('isAdmin', '==', true).get();
        snap.forEach(doc => { const e = doc.data().email; if (e) set.add(e.toLowerCase()); });
        window._dpotd_adminEmails = set;
    } catch (e) { console.warn('getAdminEmails failed', e); }
    return set;
}

// State
let currentUser = null;
let startTime, timerInterval, questionsData;
let q1StartTime, q2StartTime, q3StartTime;
let q1EndTime, q2EndTime, q3EndTime;
let exitCount = 0, exitLogs = [];
let testActive = false, currentDay = null, currentQuestion = 0;
let TEST_DURATION = 120 * 60 * 1000;
let latexUpdateTimer = null;
let autoSaveInterval = null;
let fullscreenChangeHandler, visibilityChangeHandler;
let domReady = false;
let pendingMainRender = false;

function showStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = 'status ' + type;
    el.style.display = 'block';
}

function showLoading(message) {
    const el = document.getElementById('loadingText');
    const modal = document.getElementById('loadingModal');
    if (el) el.textContent = message;
    if (modal) modal.classList.add('show');
}

function hideLoading() {
    const modal = document.getElementById('loadingModal');
    if (modal) modal.classList.remove('show');
}

function cleanAnswer(answer) {
    return answer.replace(/[^0-9-]/g, '').replace(/(?!^)-/g, '');
}

function handleLoginEnter(event) { if (event.key === 'Enter') login(); }

function showLogin() {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('forgotPasswordForm').classList.add('hidden');
}

function showForgotPassword() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('forgotPasswordForm').classList.remove('hidden');
}

async function requestPasswordReset() {
    const email = document.getElementById('resetEmail').value.trim();
    if (!email) {
        showStatus('resetStatus', 'Please enter your email address', 'error');
        return;
    }
    showLoading('Sending reset link...');
    try {
        // Use server-side API to generate and send custom email
        const response = await fetch('/api/send-password-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to send reset email');
        }

        hideLoading();
        showStatus('resetStatus', 'Password reset email sent. Check your inbox.', 'success');
        document.getElementById('resetEmail').value = '';
    } catch (error) {
        hideLoading();
        showStatus('resetStatus', 'Error: ' + error.message, 'error');
    }
}

// Auth
appAuth.onAuthStateChanged(async (user) => {
    if (!user) {
        currentUser = null;
        localStorage.removeItem('dpotdUser');
        const mainPortal = document.getElementById('mainPortal');
        if (mainPortal) mainPortal.style.display = 'none';
        return;
    }

    let isAdmin = false;
    let name = user.email;
    try {
        const userDoc = await firestore.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
            const d = userDoc.data();
            isAdmin = !!d.isAdmin;
            name = d.name || user.email;
        }
    } catch (e) { console.warn('Auth lookup failed', e); }

    if (isAdmin) {
        window.location.href = '/admin.html';
        return;
    }

    currentUser = { uid: user.uid, email: user.email, name };
    localStorage.setItem('dpotdUser', JSON.stringify(currentUser));
    showMainPortal();
});

window.addEventListener('DOMContentLoaded', () => {
    domReady = true;
    const storedUser = localStorage.getItem('dpotdUser');
    if (storedUser) {
        try { currentUser = JSON.parse(storedUser); } catch (_) { currentUser = null; }
    }
    if (appAuth.currentUser && currentUser) showMainPortal();
    if (pendingMainRender && currentUser) showMainPortal();

    const latexInput = document.getElementById('latexInput');
    if (latexInput) {
        latexInput.addEventListener('input', updateLatexPreview);
    }
});

async function login() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { showStatus('loginStatus', 'Please enter email and password', 'error'); return; }

    showLoading('Signing in...');
    try {
        const cred = await appAuth.signInWithEmailAndPassword(email, password);
        let isAdmin = false;
        let name = email;
        const userDoc = await firestore.collection('users').doc(cred.user.uid).get();
        if (userDoc.exists) {
            const d = userDoc.data();
            isAdmin = !!d.isAdmin;
            name = d.name || email;
        }
        if (isAdmin) {
            hideLoading();
            window.location.href = '/admin.html';
            return;
        }
        currentUser = { uid: cred.user.uid, email, name };
        localStorage.setItem('dpotdUser', JSON.stringify(currentUser));
        hideLoading();
        showMainPortal();
    } catch (error) {
        hideLoading();
        showStatus('loginStatus', 'Login failed: ' + error.message, 'error');
    }
}

function logout() {
    appAuth.signOut();
    currentUser = null;
    localStorage.removeItem('dpotdUser');
    document.getElementById('mainPortal').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
    location.reload();
}

function showMainPortal() {
    if (!currentUser || !domReady) { pendingMainRender = true; return; }
    pendingMainRender = false;
    const authScreen = document.getElementById('authScreen');
    const mainPortal = document.getElementById('mainPortal');
    if (authScreen) authScreen.classList.add('hidden');
    if (mainPortal) { mainPortal.classList.remove('hidden'); mainPortal.style.display = 'block'; }
    const nameEl = document.getElementById('profileName');
    if (nameEl) nameEl.textContent = currentUser.name;
    const nameInput = document.getElementById('profileNameInput');
    if (nameInput) nameInput.value = currentUser.name;
    const emailInput = document.getElementById('profileEmailInput');
    if (emailInput) emailInput.value = currentUser.email;
    loadUserRank();
    checkTodayTest();
    loadHistory();
    loadLeaderboard();
    loadSettings();
}

async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        showStatus('profileStatus', 'Please fill in all fields', 'error');
        return;
    }
    if (newPassword !== confirmPassword) {
        showStatus('profileStatus', 'New passwords do not match', 'error');
        return;
    }

    try {
        const cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, currentPassword);
        await appAuth.currentUser.reauthenticateWithCredential(cred);
        await appAuth.currentUser.updatePassword(newPassword);
        showStatus('profileStatus', 'Password updated successfully', 'success');
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmNewPassword').value = '';
    } catch (error) {
        showStatus('profileStatus', error.message, 'error');
    }
}

async function loadSettings() {
    try {
        const doc = await firestore.collection('settings').doc('appSettings').get();
        const data = doc.exists ? doc.data() : {};
        const duration = data.testDuration || 120;
        TEST_DURATION = duration * 60 * 1000;
    } catch (e) { TEST_DURATION = 120 * 60 * 1000; }
}

async function getCurrentDay() {
    const now = new Date();
    let maxDay = null;
    try {
        const snap = await firestore.collection('schedule').get();
        snap.forEach(doc => {
            const data = doc.data();
            if (!data.day || !data.openTime) return;
            const open = data.openTime.toDate();
            if (open <= now && (maxDay === null || data.day > maxDay)) maxDay = data.day;
        });
    } catch (e) { console.error('Schedule read failed', e); }
    return maxDay;
}

async function loadUserRank() {
    if (!currentUser) return;
    try {
        const adminEmails = await getAdminEmails();
        const snap = await firestore.collection('submissions').get();
        const scores = {};
        snap.forEach(doc => {
            const d = doc.data();
            const email = (d.studentEmail || '').toLowerCase();
            if (adminEmails && adminEmails.has(email)) return;
            const q1 = d.q1Correct ? 4 : 0;
            const q2 = d.q2Correct ? 6 : 0;
            const q3 = parseInt(d.q3Score || 0);
            if (!scores[email]) scores[email] = { totalScore: 0, totalTime: 0 };
            scores[email].totalScore += q1 + q2 + q3;
            scores[email].totalTime += d.totalTime || 0;
        });
        const arr = Object.entries(scores).sort((a, b) => b[1].totalScore - a[1].totalScore || a[1].totalTime - b[1].totalTime);
        const idx = arr.findIndex(e => e[0] === currentUser.email);
        if (idx === -1) return;
        const profileRank = document.getElementById('profileRank');
        const rankDisplay = document.getElementById('rankDisplay');
        const rankDetails = document.getElementById('rankDetails');
        if (profileRank) profileRank.classList.remove('hidden');
        if (rankDisplay) rankDisplay.textContent = `#${idx + 1}`;
        if (rankDetails) rankDetails.textContent = `out of ${arr.length} students`;
    } catch (e) { console.error('loadUserRank failed', e); }
}

async function loadLeaderboard() {
    const container = document.getElementById('leaderboardContainer');
    if (!container) return;
    container.innerHTML = '<p style="color:#666;text-align:center;">Loading leaderboard...</p>';
    try {
        const adminEmails = await getAdminEmails();
        const snap = await firestore.collection('submissions').get();
        const scores = {};
        snap.forEach(doc => {
            const d = doc.data();
            const email = (d.studentEmail || '').toLowerCase();
            if (adminEmails && adminEmails.has(email)) return;
            const name = d.studentName;
            const q1 = d.q1Correct ? 4 : 0;
            const q2 = d.q2Correct ? 6 : 0;
            const q3 = parseInt(d.q3Score || 0);
            if (!scores[email]) scores[email] = { name, email, totalScore: 0, completedDays: 0 };
            scores[email].totalScore += q1 + q2 + q3;
            scores[email].completedDays += 1;
        });
        const arr = Object.values(scores).sort((a, b) => b.totalScore - a.totalScore).slice(0, 10);
        if (arr.length === 0) { container.innerHTML = '<p style="text-align:center;color:#666;">No submissions yet.</p>'; return; }
        let html = '<table class="leaderboard-table"><thead><tr><th>Rank</th><th>Name</th><th>Total Score</th><th>Tests</th></tr></thead><tbody>';
        arr.forEach((e, i) => {
            const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
            html += `<tr><td><span class="rank-badge ${rankClass}">${i + 1}</span></td><td>${e.name || e.email}</td><td>${e.totalScore}</td><td>${e.completedDays}</td></tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (e) { container.innerHTML = '<p style="color:#dc3545;text-align:center;">Leaderboard unavailable</p>'; }
}

async function checkTodayTest() {
    if (!currentUser) return;
    const statusEl = document.getElementById('testStatus');
    if (!statusEl) return;
    statusEl.innerHTML = '<p style="color:#666;">Loading today\'s test...</p>';

    const day = await getCurrentDay();
    currentDay = day;
    const titleEl = document.getElementById('testTitle');
    if (titleEl && day) titleEl.textContent = `D.PotD Day ${day}`;

    if (!day) {
        statusEl.innerHTML = '<div style="text-align:center;padding:40px;"><h3 style="color:#666;">No Test Available Today</h3><p style="color:#999;">Check back on a scheduled test day.</p></div>';
        return;
    }

    const submittedSnap = await firestore.collection('submissions').where('studentEmail', '==', currentUser.email).where('day', '==', day).limit(1).get();
    if (!submittedSnap.empty) {
        statusEl.innerHTML = `<div style="text-align:center;padding:40px;"><h3 style="color:#28a745;">Test Already Submitted</h3><p style="color:#666;">You have completed Day ${day}'s test. Check Score History for results.</p></div>`;
        return;
    }

    const activeDoc = await firestore.collection('activeTests').doc(`${currentUser.uid}_day${day}`).get();
    if (activeDoc.exists) {
        const data = activeDoc.data();
        exitCount = data.exitCount || 0;
        exitLogs = data.exitLogs || [];
        statusEl.innerHTML = `<div class="resume-test-banner" style="background:#fff3cd;border:2px solid #ffc107;border-radius:8px;padding:20px;text-align:center;"><h3>Resume Your Test</h3><p>You have an active test for Day ${day}.</p><p><strong>Violations: ${exitCount}</strong></p><button class="btn" onclick="resumeTest()" style="margin-top:15px;">Resume Test</button></div>`;
        return;
    }

    const minutes = Math.floor(TEST_DURATION / 60000);
    statusEl.innerHTML = `<div style="text-align:center;padding:40px;"><h2 style="color:#EA5A2F;margin-bottom:20px;">Day ${day} Test Available</h2><p style="font-size:18px;color:#666;margin-bottom:20px;">Ready to take today's test?</p><button class="btn" onclick="showConfirmation()" style="padding:15px 40px;font-size:18px;">Start Test</button><p style="margin-top:12px;color:#999;">Time limit: ${minutes} minutes</p></div>`;
}

async function resumeTest() {
    const doc = await firestore.collection('activeTests').doc(`${currentUser.uid}_day${currentDay}`).get();
    if (!doc.exists) return;
    const data = doc.data();
    questionsData = await loadQuestions(currentDay);
    if (!questionsData) return;
    renderQuestions(questionsData);
    document.getElementById('q1Answer').value = data.q1Answer || '';
    document.getElementById('q2Answer').value = data.q2Answer || '';
    document.getElementById('latexInput').value = data.q3Answer || '';
    exitCount = data.exitCount || 0;
    exitLogs = data.exitLogs || [];
    startTime = data.startTime ? data.startTime.toMillis() : Date.now();
    enterFullscreenAndStart((typeof data.currentQuestion === 'number') ? data.currentQuestion : 0);
}

function showConfirmation() { document.getElementById('confirmationModal').classList.add('show'); }
function cancelTest() { document.getElementById('confirmationModal').classList.remove('show'); }
function confirmStart() { document.getElementById('confirmationModal').classList.remove('show'); startTest(); }

async function startTest() {
    if (!currentDay) currentDay = await getCurrentDay();
    if (!currentDay) { alert('No active test today.'); return; }
    showLoading(`Loading Day ${currentDay} questions...`);
    questionsData = await loadQuestions(currentDay);
    if (!questionsData) { hideLoading(); alert('Questions not found.'); return; }
    renderQuestions(questionsData);
    startTime = Date.now();
    const endTime = startTime + TEST_DURATION;
    await firestore.collection('activeTests').doc(`${currentUser.uid}_day${currentDay}`).set({
        userId: currentUser.uid, email: currentUser.email, day: currentDay,
        startTime: firebase.firestore.Timestamp.fromDate(new Date(startTime)),
        endTime: firebase.firestore.Timestamp.fromDate(new Date(endTime)),
        currentQuestion: 0, q1Answer: '', q2Answer: '', q3Answer: '', exitCount: 0, exitLogs: [], status: 'active'
    });
    hideLoading();
    await enterFullscreenAndStart(0);
}

async function loadQuestions(day) {
    try {
        const doc = await firestore.collection('questions').doc(`day${day}`).get();
        if (!doc.exists) return null;
        const d = doc.data();
        return {
            instructions: d.instructions || '', q1_text: d.q1Text || '', q1_answer: String(d.q1Answer || ''), q1_image: d.q1Image || '',
            q2_text: d.q2Text || '', q2_answer: String(d.q2Answer || ''), q2_image: d.q2Image || '',
            q3_text: d.q3Text || '', q3_answer: d.q3Answer || '', q3_image: d.q3Image || ''
        };
    } catch (e) { console.error('loadQuestions failed', e); return null; }
}

async function enterFullscreenAndStart(questionNum) {
    const mainPortal = document.getElementById('mainPortal');
    const questionSection = document.getElementById('questionSection');
    const navBar = document.getElementById('navigationBar');
    const sponsorFooter = document.querySelector('.sponsor-footer');
    if (mainPortal) mainPortal.style.display = 'none';
    if (questionSection) questionSection.style.display = 'block';
    if (navBar) navBar.style.display = 'block';
    if (sponsorFooter) sponsorFooter.style.display = 'none';
    document.body.classList.add('locked');
    testActive = true;
    monitorFullscreen();
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
    startAutoSave();
    showQuestion(questionNum);
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (e) { console.error('Fullscreen error:', e); }
}

function showQuestion(num) {
    ['instructionsPage', 'q1Page', 'q2Page', 'q3Page'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    if (num === 0) { const inst = document.getElementById('instructionsPage'); if (inst) inst.style.display = 'block'; }
    else { const qp = document.getElementById(`q${num}Page`); if (qp) qp.style.display = 'block'; }
    const nextBtn = document.getElementById('nextBtn');
    const submitBtn = document.getElementById('submitBtn');
    if (nextBtn && submitBtn) {
        nextBtn.style.display = num === 3 ? 'none' : 'block';
        submitBtn.style.display = num === 3 ? 'block' : 'none';
    }
    const aiBtn = document.getElementById('aiToggleBtn');
    if (aiBtn) aiBtn.style.display = num === 3 ? 'block' : 'none';
    const prev = currentQuestion;
    if (prev === 1) q1EndTime = Date.now();
    if (prev === 2) q2EndTime = Date.now();
    if (prev === 3) q3EndTime = Date.now();
    if (num === 1 && !q1StartTime) q1StartTime = Date.now();
    if (num === 2 && !q2StartTime) q2StartTime = Date.now();
    if (num === 3) q3StartTime = Date.now();
    currentQuestion = num;
    if (testActive && currentUser && currentDay !== null) {
        try { firestore.collection('activeTests').doc(`${currentUser.uid}_day${currentDay}`).set({ currentQuestion }, { merge: true }); } catch (e) { }
    }
}

function nextQuestion() { if (currentQuestion < 3) showQuestion(currentQuestion + 1); }

function updateTimer() {
    if (!startTime) return;
    const remaining = Math.max(0, TEST_DURATION - (Date.now() - startTime));
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const timer = document.getElementById('timer');
    if (timer) {
        timer.textContent = `Time Remaining: ${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        timer.style.display = 'block';
        timer.style.color = remaining < 600000 ? '#ff6b6b' : '#000';
    }
    if (remaining <= 0) { clearInterval(timerInterval); submitTest(true); }
}

async function submitTest(isForced = false) {
    if (!testActive && !isForced) return;
    const q1Answer = cleanAnswer(document.getElementById('q1Answer')?.value?.trim() || '');
    const q2Answer = cleanAnswer(document.getElementById('q2Answer')?.value?.trim() || '');
    const q3Answer = document.getElementById('latexInput')?.value?.trim() || '';
    if (!isForced && (!q1Answer || !q2Answer || !q3Answer)) { alert('Please answer all questions before submitting.'); return; }
    testActive = false;
    clearInterval(timerInterval);
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    document.removeEventListener('fullscreenchange', fullscreenChangeHandler);
    document.removeEventListener('visibilitychange', visibilityChangeHandler);
    const endTime = Date.now();
    q3EndTime = endTime;
    const q1Time = q1EndTime && q1StartTime ? Math.floor((q1EndTime - q1StartTime) / 1000) : 0;
    const q2Time = q2EndTime && q2StartTime ? Math.floor((q2EndTime - q2StartTime) / 1000) : 0;
    const q3Time = q3StartTime ? Math.floor((q3EndTime - q3StartTime) / 1000) : 0;
    const totalTime = Math.floor((endTime - startTime) / 1000);
    const q1Correct = q1Answer === cleanAnswer(questionsData.q1_answer);
    const q2Correct = q2Answer === cleanAnswer(questionsData.q2_answer);
    const submission = {
        userId: currentUser.uid, studentName: currentUser.name, studentEmail: currentUser.email, day: currentDay,
        q1Answer, q2Answer, q3Answer, q1Correct, q2Correct, q1Time, q2Time, q3Time, totalTime, exitCount, exitLogs,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    showLoading(isForced ? 'Auto-submitting...' : 'Submitting...');
    try {
        await firestore.collection('submissions').add(submission);
        await firestore.collection('activeTests').doc(`${currentUser.uid}_day${currentDay}`).delete();
        hideLoading();
        document.body.classList.remove('locked');
        if (document.exitFullscreen) document.exitFullscreen();
        const questionSection = document.getElementById('questionSection');
        const mainPortal = document.getElementById('mainPortal');
        const timer = document.getElementById('timer');
        const sponsorFooter = document.querySelector('.sponsor-footer');
        if (timer) timer.style.display = 'none';
        if (questionSection) questionSection.style.display = 'none';
        if (mainPortal) mainPortal.style.display = 'block';
        if (sponsorFooter) sponsorFooter.style.display = 'flex';
        loadUserRank();
        const q1Points = q1Correct ? 4 : 0;
        const q2Points = q2Correct ? 6 : 0;
        const testStatus = document.getElementById('testStatus');
        if (testStatus) {
            testStatus.innerHTML = `<div style="text-align:center;padding:40px;"><h2 style="color:#28a745;">Test Submitted Successfully!</h2><p style="font-size:18px;color:#666;">Your responses have been recorded.</p><div style="background:#f8f9fa;padding:30px;border-radius:8px;max-width:500px;margin:20px auto;"><div style="background:#EA5A2F;color:white;padding:15px;border-radius:8px;margin-bottom:20px;"><strong style="font-size:20px;">Current Score: ${q1Points + q2Points}/20</strong><p style="margin-top:5px;font-size:14px;">Q3 will be graded manually</p></div><div style="margin-bottom:15px;text-align:left;"><strong>Q1:</strong> <span class="${q1Correct ? 'correct' : 'incorrect'}">${q1Correct ? 'Correct (+4 pts)' : 'Incorrect (0 pts)'}</span></div><div style="margin-bottom:15px;text-align:left;"><strong>Q2:</strong> <span class="${q2Correct ? 'correct' : 'incorrect'}">${q2Correct ? 'Correct (+6 pts)' : 'Incorrect (0 pts)'}</span></div><div style="text-align:left;"><strong>Q3:</strong> Pending manual grading</div></div></div>`;
        }
    } catch (error) {
        hideLoading();
        alert('Error submitting: ' + error.message);
        testActive = true;
    }
}

function recordViolation(type) {
    if (!testActive) return;
    exitCount++;
    exitLogs.push({ time: new Date().toISOString(), type });
    const vc = document.getElementById('violationCount');
    if (vc) vc.textContent = exitCount;
    document.getElementById('warningOverlay')?.classList.add('show');
    if (currentUser && currentDay !== null) {
        try { firestore.collection('activeTests').doc(`${currentUser.uid}_day${currentDay}`).set({ exitCount, exitLogs }, { merge: true }); } catch (e) { }
    }
}

function returnToFullscreen() {
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().then(() => document.getElementById('warningOverlay')?.classList.remove('show')).catch(() => alert('Please allow fullscreen'));
    }
}

function monitorFullscreen() {
    fullscreenChangeHandler = () => { if (!document.fullscreenElement && testActive) recordViolation('exited_fullscreen'); };
    visibilityChangeHandler = () => { if (document.hidden && testActive) recordViolation('tab_hidden'); };
    document.addEventListener('fullscreenchange', fullscreenChangeHandler);
    document.addEventListener('visibilitychange', visibilityChangeHandler);
}

async function loadHistory() {
    if (!currentUser) return;
    const container = document.getElementById('historyContainer');
    if (!container) return;
    container.innerHTML = '<p style="color:#666;">Loading history...</p>';
    try {
        const snap = await firestore.collection('submissions').where('studentEmail', '==', currentUser.email).orderBy('timestamp', 'desc').get();
        const subs = snap.docs.map(doc => doc.data());
        if (subs.length === 0) { container.innerHTML = '<p style="color:#666;text-align:center;">No submissions yet.</p>'; return; }
        container.innerHTML = '';
        subs.forEach(sub => {
            const card = document.createElement('div');
            card.className = 'score-card';
            const date = sub.timestamp ? sub.timestamp.toDate().toLocaleString() : '';
            const q1 = sub.q1Correct ? 4 : 0;
            const q2 = sub.q2Correct ? 6 : 0;
            const q3 = parseInt(sub.q3Score || 0);
            let feedbackHTML = '';
            if (sub.q3Feedback) {
                const fid = `fb_${Math.random().toString(36).slice(2)}`;
                feedbackHTML = `<div class="feedback-box"><h4>Q3 Feedback</h4><div id="${fid}">${sub.q3Feedback}</div></div>`;
                setTimeout(() => { const el = document.getElementById(fid); if (el && window.MathJax) MathJax.typesetPromise([el]).catch(() => { }); }, 100);
            }
            card.innerHTML = `<div class="score-header"><h3>Day ${sub.day}</h3><span style="color:#666;font-size:14px;">${date}</span></div><div style="background:#EA5A2F;color:white;padding:15px;border-radius:8px;margin-bottom:15px;text-align:center;"><strong style="font-size:24px;">Total: ${q1 + q2 + q3}/20</strong></div><div class="score-details"><div class="score-item"><strong>Q1:</strong> <span class="${sub.q1Correct ? 'correct' : 'incorrect'}">${sub.q1Correct ? '+4' : '0'}</span></div><div class="score-item"><strong>Q2:</strong> <span class="${sub.q2Correct ? 'correct' : 'incorrect'}">${sub.q2Correct ? '+6' : '0'}</span></div><div class="score-item"><strong>Q3:</strong> ${sub.q3Score !== undefined ? sub.q3Score + '/10' : 'Pending'}</div><div class="score-item"><strong>Time:</strong> ${Math.floor((sub.totalTime || 0) / 60)}m</div></div>${feedbackHTML}`;
            container.appendChild(card);
        });
    } catch (e) { container.innerHTML = '<p style="color:#dc3545;">Error loading history</p>'; }
}

function updateLatexPreview() {
    if (latexUpdateTimer) clearTimeout(latexUpdateTimer);
    latexUpdateTimer = setTimeout(() => {
        const input = document.getElementById('latexInput')?.value || '';
        const preview = document.getElementById('latexPreview');
        if (!preview) return;
        if (!input.trim()) { preview.innerHTML = '<p style="color:#999;">Your formatted proof will appear here...</p>'; return; }
        let content = input.replace(/\\documentclass\{[^}]+\}/g, '').replace(/\\usepackage\{[^}]+\}/g, '');
        const docMatch = content.match(/\\begin\{document\}([\s\S]*)\\end\{document\}/);
        if (docMatch) content = docMatch[1].trim();
        preview.innerHTML = content || '<p style="color:#999;">Write your proof...</p>';
        if (window.MathJax && window.MathJax.typesetPromise) { MathJax.typesetClear([preview]); MathJax.typesetPromise([preview]).catch(() => { }); }
    }, 500);
}

function switchMainTab(tab) {
    document.querySelectorAll('#mainPortal .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#mainPortal .tab-content').forEach(c => c.classList.remove('active'));
    const btn = [...document.querySelectorAll('#mainPortal .tab')].find(t => t.textContent.toLowerCase().includes(tab === 'today' ? 'today' : tab === 'leaderboard' ? 'leaderboard' : tab === 'history' ? 'history' : 'profile'));
    if (btn) btn.classList.add('active');
    const target = document.getElementById(`${tab}Tab`);
    if (target) target.classList.add('active');
    if (tab === 'today') checkTodayTest();
    if (tab === 'history') loadHistory();
    if (tab === 'leaderboard') loadLeaderboard();
}

function toggleAIHelper() { /* LaTeX helper toggle - placeholder */ }

function startAutoSave() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = setInterval(async () => {
        if (!testActive || !currentUser || currentDay === null) return;
        try {
            await firestore.collection('activeTests').doc(`${currentUser.uid}_day${currentDay}`).set({
                q1Answer: document.getElementById('q1Answer')?.value || '',
                q2Answer: document.getElementById('q2Answer')?.value || '',
                q3Answer: document.getElementById('latexInput')?.value || '',
                currentQuestion: currentQuestion || 0, exitCount: exitCount || 0, exitLogs: exitLogs || []
            }, { merge: true });
        } catch (e) { }
    }, 5000);
}

function renderQuestions(q) {
    if (!q) return;
    const q1Text = document.getElementById('q1Text');
    const q2Text = document.getElementById('q2Text');
    const q3Text = document.getElementById('q3Text');
    const instructionsContent = document.getElementById('instructionsContent');
    if (instructionsContent) instructionsContent.innerHTML = q.instructions || '';
    if (q1Text) q1Text.innerHTML = q.q1_text || '';
    if (q2Text) q2Text.innerHTML = q.q2_text || '';
    if (q3Text) q3Text.innerHTML = q.q3_text || '';
    const q1Img = document.getElementById('q1Image');
    const q2Img = document.getElementById('q2Image');
    const q3Img = document.getElementById('q3Image');
    if (q1Img) { q1Img.src = q.q1_image || ''; q1Img.style.display = q.q1_image ? 'block' : 'none'; }
    if (q2Img) { q2Img.src = q.q2_image || ''; q2Img.style.display = q.q2_image ? 'block' : 'none'; }
    if (q3Img) { q3Img.src = q.q3_image || ''; q3Img.style.display = q.q3_image ? 'block' : 'none'; }
    if (window.MathJax && window.MathJax.typesetPromise) {
        setTimeout(() => { MathJax.typesetPromise([instructionsContent, q1Text, q2Text, q3Text].filter(Boolean)).catch(() => { }); }, 50);
    }
}

document.addEventListener('keydown', (e) => {
    if (testActive) {
        const blocked = [e.keyCode === 123, (e.ctrlKey || e.metaKey) && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74), (e.ctrlKey || e.metaKey) && e.keyCode === 85, e.keyCode === 27];
        if (blocked.some(x => x)) { e.preventDefault(); return false; }
    }
});

document.addEventListener('contextmenu', (e) => { if (testActive) e.preventDefault(); });

window.addEventListener('beforeunload', (e) => {
    if (testActive) { e.preventDefault(); e.returnValue = ''; recordViolation('attempted_close'); return ''; }
});
