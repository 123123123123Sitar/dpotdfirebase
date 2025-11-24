// Firebase Admin Portal Logic (Firestore + Auth)
// This replaces the old Google Apps Script calls used in admin.js

// Globals from firebase-config.js (firebase initialized there)
const firestore = firebase.firestore();
const appAuth = firebase.auth();
// Secondary auth so we can create users without dropping the admin session
const secondaryApp = firebase.apps.find(app => app.name === 'secondary') || firebase.initializeApp(firebase.apps[0].options, 'secondary');
const secondaryAuth = secondaryApp.auth();

let cachedSubmissions = [];
let filteredSubmissions = [];
let currentSubmissionIndex = 0;
let latexUpdateTimers = {};
let isAuthenticated = false;
let adminCredentials = { email: '', password: '' };

// -------------------- Auth --------------------
appAuth.onAuthStateChanged(async (user) => {
    if (!user) {
        isAuthenticated = false;
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('adminPanel').style.display = 'none';
        return;
    }

    let data = null;
    let docId = user.uid;
    let userDoc = await firestore.collection('users').doc(docId).get();
    if (userDoc.exists) {
        data = userDoc.data();
    } else {
        // Fallback for legacy docs keyed by email
        const snap = await firestore.collection('users').where('email', '==', user.email || '').limit(1).get();
        if (!snap.empty) {
            userDoc = snap.docs[0];
            data = userDoc.data();
            docId = userDoc.id;
        }
    }

    if (!data || data.isAdmin !== true) {
        // Fallback: allow the configured admin email from settings/appSettings
        try {
            const settingsDoc = await firestore.collection('settings').doc('appSettings').get();
            const settingsEmail = settingsDoc.exists ? settingsDoc.data().adminEmail : '';
            if (settingsEmail && settingsEmail.toLowerCase() === (user.email || '').toLowerCase()) {
                data = { isAdmin: true };
            }
        } catch (e) {
            console.warn('settings fallback failed', e);
        }
    }

    if (!data || data.isAdmin !== true) {
        document.getElementById('loginError').textContent = 'Not authorized for admin portal';
        document.getElementById('loginError').style.display = 'block';
        await appAuth.signOut();
        return;
    }

    isAuthenticated = true;
    adminCredentials.email = user.email || '';
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    loadQuestions();
    loadSettings();
});

async function checkPassword() {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const loginError = document.getElementById('loginError');
    loginError.style.display = 'none';

    try {
        await appAuth.signInWithEmailAndPassword(email, password);
        adminCredentials = { email, password };
    } catch (err) {
        loginError.textContent = err.message || 'Login failed';
        loginError.style.display = 'block';
    }
}

function handlePasswordKeyPress(event) {
    if (event.key === 'Enter') {
        checkPassword();
    }
}

// -------------------- Helpers --------------------
function showStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.className = 'status ' + type;
    el.style.display = 'block';
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(tabName).classList.add('active');

    if (tabName === 'questions') loadQuestions();
    if (tabName === 'schedule') loadSchedule();
    if (tabName === 'settings') loadSettings();
    if (tabName === 'users') loadUsers();
    if (tabName === 'submissions') loadSubmissions();
}

function formatDateTimeLocal(date) {
    if (!date) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

// Image Upload Handler
function handleImageUpload(questionNum) {
    const input = document.getElementById(`q${questionNum}Image`);
    const preview = document.getElementById(`q${questionNum}ImagePreview`);
    const dataField = document.getElementById(`q${questionNum}ImageData`);

    const file = input.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64 = e.target.result;
        dataField.value = base64;
        preview.innerHTML = `<img src="${base64}" alt="Question ${questionNum} Image">`;
    };
    reader.readAsDataURL(file);
}

// -------------------- Questions --------------------
async function loadQuestions() {
    if (!isAuthenticated) return;

    const day = document.getElementById('questionDay').value;
    const statusEl = document.getElementById('questionStatus');
    statusEl.style.display = 'none';

    try {
        const doc = await firestore.collection('questions').doc(`day${day}`).get();
        const data = doc.exists ? doc.data() : {};

        document.getElementById('q1Text').value = data.q1Text || '';
        document.getElementById('q1Answer').value = data.q1Answer || '';
        if (data.q1Image) {
            document.getElementById('q1ImageData').value = data.q1Image;
            document.getElementById('q1ImagePreview').innerHTML = `<img src="${data.q1Image}" alt="Question 1 Image">`;
        }

        document.getElementById('q2Text').value = data.q2Text || '';
        document.getElementById('q2Answer').value = data.q2Answer || '';
        if (data.q2Image) {
            document.getElementById('q2ImageData').value = data.q2Image;
            document.getElementById('q2ImagePreview').innerHTML = `<img src="${data.q2Image}" alt="Question 2 Image">`;
        }

        document.getElementById('q3Text').value = data.q3Text || '';
        document.getElementById('q3Answer').value = data.q3Answer || '';
        if (data.q3Image) {
            document.getElementById('q3ImageData').value = data.q3Image;
            document.getElementById('q3ImagePreview').innerHTML = `<img src="${data.q3Image}" alt="Question 3 Image">`;
        }
    } catch (error) {
        showStatus('questionStatus', 'Error loading questions: ' + error.message, 'error');
    }
}

async function saveQuestions() {
    if (!isAuthenticated) return;
    const day = document.getElementById('questionDay').value;

    const payload = {
        day: Number(day),
        q1Text: document.getElementById('q1Text').value,
        q1Answer: document.getElementById('q1Answer').value,
        q1Image: document.getElementById('q1ImageData').value || '',
        q2Text: document.getElementById('q2Text').value,
        q2Answer: document.getElementById('q2Answer').value,
        q2Image: document.getElementById('q2ImageData').value || '',
        q3Text: document.getElementById('q3Text').value,
        q3Answer: document.getElementById('q3Answer').value,
        q3Image: document.getElementById('q3ImageData').value || ''
    };

    try {
        await firestore.collection('questions').doc(`day${day}`).set(payload, { merge: true });
        showStatus('questionStatus', 'Questions saved to Firestore', 'success');
    } catch (error) {
        showStatus('questionStatus', 'Error saving questions: ' + error.message, 'error');
    }
}

// -------------------- Schedule --------------------
async function loadSchedule() {
    if (!isAuthenticated) return;
    const statusEl = document.getElementById('scheduleStatus');
    statusEl.style.display = 'none';

    try {
        for (let i = 1; i <= 5; i++) {
            const doc = await firestore.collection('schedule').doc(`day${i}`).get();
            const data = doc.exists ? doc.data() : {};
            const openTime = data.openTime ? data.openTime.toDate() : null;
            document.getElementById(`day${i}`).value = formatDateTimeLocal(openTime);
        }
    } catch (error) {
        showStatus('scheduleStatus', 'Error loading schedule: ' + error.message, 'error');
    }
}

async function saveSchedule() {
    if (!isAuthenticated) return;

    try {
        const batch = firestore.batch();
        for (let i = 1; i <= 5; i++) {
            const val = document.getElementById(`day${i}`).value;
            if (!val) continue;
            const dt = new Date(val);
            const ref = firestore.collection('schedule').doc(`day${i}`);
            batch.set(ref, { day: i, openTime: firebase.firestore.Timestamp.fromDate(dt) }, { merge: true });
        }
        await batch.commit();
        showStatus('scheduleStatus', 'Schedule saved', 'success');
    } catch (error) {
        showStatus('scheduleStatus', 'Error saving schedule: ' + error.message, 'error');
    }
}

// -------------------- Settings --------------------
async function loadSettings() {
    if (!isAuthenticated) return;
    const statusEl = document.getElementById('settingsStatus');
    statusEl.style.display = 'none';

    try {
        const doc = await firestore.collection('settings').doc('appSettings').get();
        const data = doc.exists ? doc.data() : {};
        document.getElementById('testDuration').value = data.testDuration || 120;
        document.getElementById('adminName').value = data.adminName || '';
        document.getElementById('adminEmail').value = data.adminEmail || '';
    } catch (error) {
        showStatus('settingsStatus', 'Error loading settings: ' + error.message, 'error');
    }
}

async function saveSettings() {
    if (!isAuthenticated) return;
    try {
        await firestore.collection('settings').doc('appSettings').set({
            testDuration: Number(document.getElementById('testDuration').value) || 120,
            adminName: document.getElementById('adminName').value,
            adminEmail: document.getElementById('adminEmail').value
        }, { merge: true });
        showStatus('settingsStatus', 'Settings saved', 'success');
    } catch (error) {
        showStatus('settingsStatus', 'Error saving settings: ' + error.message, 'error');
    }
}

// -------------------- Users --------------------
async function loadUsers() {
    if (!isAuthenticated) return;
    const container = document.getElementById('usersContainer');
    container.innerHTML = '<p style="color: #666;">Loading users...</p>';

    try {
        const snapshot = await firestore.collection('users').get();
        if (snapshot.empty) {
            container.innerHTML = '<p style="color: #666;">No users found.</p>';
            return;
        }

        container.innerHTML = '';
        snapshot.forEach(doc => {
            const user = doc.data();
            const card = document.createElement('div');
            card.className = 'submission-card';
            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <h3 style="margin:0 0 6px 0;">${user.name || 'Unknown'}</h3>
                        <p style="color:#666;">${user.email || ''}</p>
                        <p style="color:#666; font-size:14px;">Created: ${user.createdAt ? user.createdAt.toDate().toLocaleString() : 'N/A'}</p>
                        <p style="color:${user.isAdmin ? '#28a745' : '#666'}; font-weight:600;">${user.isAdmin ? 'Admin' : 'Student'}</p>
                    </div>
                    <button class="btn-secondary" onclick="deleteUser('${doc.id}')">Delete</button>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (error) {
        showStatus('usersStatus', 'Error loading users: ' + error.message, 'error');
    }
}

async function addUser() {
    if (!isAuthenticated) return;
    const name = document.getElementById('newUserName').value.trim();
    const email = document.getElementById('newUserEmail').value.trim();
    const tempPassword = document.getElementById('newUserPassword').value.trim();

    if (!name || !email || !tempPassword) {
        alert('Please fill name, email, and temporary password');
        return;
    }

    try {
        // Create the user using secondary auth so the admin stays signed in
        const newUser = await secondaryAuth.createUserWithEmailAndPassword(email, tempPassword);
        const uid = newUser.user.uid;
        await firestore.collection('users').doc(uid).set({
            name,
            email,
            isAdmin: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await secondaryAuth.sendPasswordResetEmail(email);
        alert('User created. Password reset email sent.');
    } catch (error) {
        alert('Error creating user: ' + error.message);
    }
    loadUsers();
}

async function deleteUser(userId) {
    if (!confirm('Delete this user from Firestore? (Auth deletion must be done in Firebase Console)')) return;
    try {
        await firestore.collection('users').doc(userId).delete();
        alert('User document deleted. Remember to remove the auth user in Firebase Console.');
        loadUsers();
    } catch (error) {
        alert('Error deleting user: ' + error.message);
    }
}

// -------------------- Submissions --------------------
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
}

async function loadSubmissions() {
    if (!isAuthenticated) return;
    const container = document.getElementById('submissionsContainer');
    container.innerHTML = '<p style="color: #666;">Loading submissions...</p>';

    try {
        const snapshot = await firestore.collection('submissions').orderBy('timestamp', 'desc').get();
        const submissions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                timestamp: data.timestamp ? data.timestamp.toDate() : null,
                studentName: data.studentName || '',
                studentEmail: data.studentEmail || '',
                day: data.day || '',
                q1_answer: data.q1Answer || '',
                q2_answer: data.q2Answer || '',
                q3_answer: data.q3Answer || '',
                q1_correct: !!data.q1Correct,
                q2_correct: !!data.q2Correct,
                q1_time: data.q1Time || 0,
                q2_time: data.q2Time || 0,
                q3_time: data.q3Time || 0,
                totalTime: data.totalTime || 0,
                exitCount: data.exitCount || 0,
                exitLogs: data.exitLogs || [],
                q3_score: data.q3Score || '',
                q3_feedback: data.q3Feedback || ''
            };
        });

        cachedSubmissions = submissions;

        if (submissions.length === 0) {
            container.innerHTML = '<p style="color: #666; text-align: center; padding: 40px;">No submissions yet.</p>';
            document.getElementById('navControls').style.display = 'none';
            return;
        }

        // Populate filters
        const studentFilter = document.getElementById('filterStudent');
        const uniqueStudents = [...new Set(submissions.map(s => s.studentEmail))];
        studentFilter.innerHTML = '<option value="all">All Students</option>';
        uniqueStudents.forEach(email => {
            const sub = submissions.find(s => s.studentEmail === email);
            studentFilter.innerHTML += `<option value="${email}">${sub.studentName} (${email})</option>`;
        });

        filterSubmissions();
    } catch (error) {
        showStatus('submissionsStatus', 'Error loading submissions: ' + error.message, 'error');
        container.innerHTML = '<p style="color: #dc3545; text-align: center; padding: 40px;">Error loading submissions</p>';
    }
}

function filterSubmissions() {
    const dayFilter = document.getElementById('filterDay').value;
    const studentFilter = document.getElementById('filterStudent').value;

    filteredSubmissions = cachedSubmissions.filter(sub => {
        const dayMatch = dayFilter === 'all' || sub.day == dayFilter;
        const studentMatch = studentFilter === 'all' || sub.studentEmail === studentFilter;
        return dayMatch && studentMatch;
    });

    if (filteredSubmissions.length === 0) {
        document.getElementById('submissionsContainer').innerHTML = '<p style="color: #666; text-align: center; padding: 40px;">No submissions match the filters.</p>';
        document.getElementById('navControls').style.display = 'none';
        return;
    }

    currentSubmissionIndex = 0;
    populateSubmissionSelector();
    document.getElementById('navControls').style.display = 'flex';
    displayCurrentSubmission();
}

function populateSubmissionSelector() {
    const selector = document.getElementById('submissionSelector');
    selector.innerHTML = '';

    filteredSubmissions.forEach((sub, index) => {
        const option = document.createElement('option');
        option.value = index;
        const dateStr = sub.timestamp ? new Date(sub.timestamp).toLocaleDateString() : '';
        option.textContent = `${sub.studentName} - Day ${sub.day} - ${dateStr}`;
        selector.appendChild(option);
    });

    selector.value = currentSubmissionIndex;
}

function selectSubmission() {
    currentSubmissionIndex = parseInt(document.getElementById('submissionSelector').value);
    displayCurrentSubmission();
}

function navigateSubmission(direction) {
    currentSubmissionIndex += direction;
    if (currentSubmissionIndex < 0) currentSubmissionIndex = 0;
    if (currentSubmissionIndex >= filteredSubmissions.length) currentSubmissionIndex = filteredSubmissions.length - 1;

    document.getElementById('submissionSelector').value = currentSubmissionIndex;
    displayCurrentSubmission();
}

function updateLatexPreview(rowKey) {
    if (latexUpdateTimers[rowKey]) clearTimeout(latexUpdateTimers[rowKey]);
    latexUpdateTimers[rowKey] = setTimeout(() => {
        const input = document.getElementById(`feedback_latex_${rowKey}`);
        const preview = document.getElementById(`feedback_preview_${rowKey}`);
        if (!input || !preview) return;

        let content = input.value || '';
        content = content.replace(/\\documentclass\{[^}]+\}/g, '');
        content = content.replace(/\\usepackage\{[^}]+\}/g, '');
        content = content.replace(/\\title\{[^}]*\}/g, '');
        content = content.replace(/\\author\{[^}]*\}/g, '');
        content = content.replace(/\\date\{[^}]*\}/g, '');
        content = content.replace(/\\maketitle/g, '');

        const docMatch = content.match(/\\begin\{document\}([\s\S]*)\\end\{document\}/);
        if (docMatch) content = docMatch[1].trim();

        preview.innerHTML = content || '<p style="color: #999;">Write your feedback...</p>';

        if (window.MathJax && window.MathJax.typesetPromise) {
            MathJax.typesetClear([preview]);
            MathJax.typesetPromise([preview]).catch((err) => {
                console.error('MathJax error:', err);
                preview.innerHTML += '<p style="color: #dc3545; font-size: 12px; margin-top: 10px;"><strong>⚠️ LaTeX Error:</strong> Check your syntax</p>';
            });
        }
    }, 500);
}

function displayCurrentSubmission() {
    const container = document.getElementById('submissionsContainer');
    const sub = filteredSubmissions[currentSubmissionIndex];
    if (!sub) return;

    document.getElementById('prevBtn').disabled = currentSubmissionIndex === 0;
    document.getElementById('nextBtn').disabled = currentSubmissionIndex === filteredSubmissions.length - 1;

    let exitLogs = [];
    try {
        exitLogs = Array.isArray(sub.exitLogs) ? sub.exitLogs : JSON.parse(sub.exitLogs || '[]');
    } catch (e) {
        exitLogs = [];
    }

    const q1Points = sub.q1_correct ? 5 : 0;
    const q2Points = sub.q2_correct ? 5 : 0;
    const q3Points = sub.q3_score || 0;
    const totalPoints = q1Points + q2Points + parseInt(q3Points || 0);
    const rowKey = sub.id;

    container.innerHTML = `
        <div class="submission-card">
            <div class="submission-header">
                <h3>Day ${sub.day} Submission</h3>
                <span class="graded-badge ${sub.q3_score ? 'graded' : 'pending'}">${sub.q3_score ? 'Graded' : 'Pending'}</span>
            </div>
            <div class="submission-details">
                <div class="detail-item"><span class="detail-label">Student:</span> ${sub.studentName} (${sub.studentEmail})</div>
                <div class="detail-item"><span class="detail-label">Submitted:</span> ${sub.timestamp ? new Date(sub.timestamp).toLocaleString() : ''}</div>
                <div class="detail-item"><span class="detail-label">Total Time:</span> ${formatTime(sub.totalTime || 0)}</div>
                <div class="detail-item"><span class="detail-label">Exit Count:</span> ${sub.exitCount || 0}</div>
                <div class="detail-item"><span class="detail-label">Total Points:</span> ${totalPoints}/20</div>
            </div>
            <div class="override-controls">
                <h4>Auto-Graded Questions Override</h4>
                <div class="override-buttons">
                    <strong>Q1 (${sub.q1_correct ? '✓ Correct' : '✗ Incorrect'}):</strong>
                    <button class="override-btn correct" onclick="overrideScore('${rowKey}', 1, true)">Mark Correct</button>
                    <button class="override-btn incorrect" onclick="overrideScore('${rowKey}', 1, false)">Mark Incorrect</button>
                </div>
                <div class="override-buttons" style="margin-top:10px;">
                    <strong>Q2 (${sub.q2_correct ? '✓ Correct' : '✗ Incorrect'}):</strong>
                    <button class="override-btn correct" onclick="overrideScore('${rowKey}', 2, true)">Mark Correct</button>
                    <button class="override-btn incorrect" onclick="overrideScore('${rowKey}', 2, false)">Mark Incorrect</button>
                </div>
            </div>
            <div class="question-group">
                <h3>Q1 Answer</h3>
                <p>${sub.q1_answer || '<em>No answer</em>'}</p>
                <p><strong>${sub.q1_correct ? 'Correct (+5)' : 'Incorrect (0)'}</strong> • Time: ${formatTime(sub.q1_time || 0)}</p>
            </div>
            <div class="question-group">
                <h3>Q2 Answer</h3>
                <p>${sub.q2_answer || '<em>No answer</em>'}</p>
                <p><strong>${sub.q2_correct ? 'Correct (+5)' : 'Incorrect (0)'}</strong> • Time: ${formatTime(sub.q2_time || 0)}</p>
            </div>
            <div class="question-group">
                <h3>Q3 Answer (LaTeX)</h3>
                <div class="latex-editor-container">
                    <div class="latex-input-section">
                        <h4>Score (0-10)</h4>
                        <input type="number" id="score_${rowKey}" min="0" max="10" step="1" value="${sub.q3_score || ''}" style="margin-bottom: 10px;">
                        <h4>Feedback (LaTeX)</h4>
                        <textarea id="feedback_latex_${rowKey}" oninput="updateLatexPreview('${rowKey}')" placeholder="Write LaTeX feedback...">${sub.q3_feedback || ''}</textarea>
                        <button class="btn" style="margin-top: 10px;" onclick="saveFeedback('${rowKey}')">Save Feedback &amp; Notify</button>
                    </div>
                    <div class="latex-preview-section">
                        <h4>Preview</h4>
                        <div id="feedback_preview_${rowKey}" class="preview-content">${sub.q3_feedback || '<p style="color:#999;">Preview will render here</p>'}</div>
                    </div>
                </div>
                <p style="margin-top: 10px; color: #666;">Time: ${formatTime(sub.q3_time || 0)}</p>
            </div>
            <div class="question-group">
                <h3>Exit Logs</h3>
                ${exitLogs.length === 0 ? '<p style="color:#666;">No violations recorded</p>' : exitLogs.map(log => `<p>• ${log.time} – ${log.type}</p>`).join('')}
            </div>
        </div>
    `;

    if (sub.q3_feedback) {
        setTimeout(() => updateLatexPreview(rowKey), 100);
    }

    showStatus('submissionsStatus', `Viewing submission ${currentSubmissionIndex + 1} of ${filteredSubmissions.length}`, 'info');
}

async function overrideScore(docId, questionNum, isCorrect) {
    if (!confirm(`Mark Q${questionNum} as ${isCorrect ? 'CORRECT' : 'INCORRECT'}?`)) return;

    const field = questionNum === 1 ? 'q1Correct' : 'q2Correct';
    try {
        await firestore.collection('submissions').doc(docId).update({ [field]: isCorrect });
        alert('Score updated');
        loadSubmissions();
    } catch (error) {
        alert('Error overriding score: ' + error.message);
    }
}

async function saveFeedback(docId) {
    const scoreInput = document.getElementById(`score_${docId}`);
    const feedbackInput = document.getElementById(`feedback_latex_${docId}`);
    if (!scoreInput || !feedbackInput) return;

    const score = parseInt(scoreInput.value, 10);
    const feedback = feedbackInput.value;
    if (isNaN(score) || score < 0 || score > 10) {
        alert('Score must be between 0 and 10');
        return;
    }
    if (!feedback) {
        alert('Please enter feedback');
        return;
    }

    try {
        await firestore.collection('submissions').doc(docId).update({
            q3Score: score,
            q3Feedback: feedback
        });
        alert('Feedback saved');
        loadSubmissions();
    } catch (error) {
        alert('Error saving feedback: ' + error.message);
    }
}

// Optional admin-triggered password reset (uses the same Apps Script hook)
async function sendPasswordReset(email) {
    if (!email) return alert('Missing email');
    try {
        await fetch('/api/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        alert('Password reset email sent (via Apps Script)');
    } catch (err) {
        alert('Error sending reset: ' + (err.message || err));
    }
}

// -------------------- CSV Export --------------------
function exportToCSV() {
    if (!isAuthenticated) return;

    if (cachedSubmissions.length === 0) {
        alert('No submissions to export. Please load submissions first.');
        return;
    }

    const headers = [
        'Student Name','Email','Day','Timestamp','Q1 Answer','Q1 Correct','Q1 Points','Q1 Time (s)',
        'Q2 Answer','Q2 Correct','Q2 Points','Q2 Time (s)','Q3 Answer','Q3 Time (s)','Q3 Score','Q3 Feedback','Total Points','Total Time (s)','Exit Count','Violations'
    ];

    const rows = cachedSubmissions.map(sub => {
        let exitLogs = [];
        try { exitLogs = Array.isArray(sub.exitLogs) ? sub.exitLogs : JSON.parse(sub.exitLogs || '[]'); } catch (e) { exitLogs = []; }
        const violations = exitLogs.map(log => `${log.time}: ${log.type}`).join('; ');
        const q1Points = sub.q1_correct ? 5 : 0;
        const q2Points = sub.q2_correct ? 5 : 0;
        const q3Points = sub.q3_score || 0;
        const totalPoints = q1Points + q2Points + parseInt(q3Points || 0);

        return [
            sub.studentName,
            sub.studentEmail,
            sub.day,
            sub.timestamp,
            sub.q1_answer,
            sub.q1_correct,
            q1Points,
            sub.q1_time,
            sub.q2_answer,
            sub.q2_correct,
            q2Points,
            sub.q2_time,
            `"${(sub.q3_answer || '').replace(/"/g, '""')}"`,
            sub.q3_time,
            sub.q3_score || '',
            `"${(sub.q3_feedback || '').replace(/"/g, '""')}"`,
            totalPoints,
            sub.totalTime,
            sub.exitCount,
            `"${violations}"`
        ];
    });

    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'submissions.csv';
    a.click();
    window.URL.revokeObjectURL(url);
}
