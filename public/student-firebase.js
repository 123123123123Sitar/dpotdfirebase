// D.PotD Student Portal Logic

const firestore = firebase.firestore();
const appAuth = firebase.auth();

let currentUser = null;
let currentDay = null;
let testStartTime = null;
let timerInterval = null;
let testDuration = 120; // minutes
let questionData = {};
let activeTest = null;

// Auth
appAuth.onAuthStateChanged(async function (user) {
    if (!user) {
        currentUser = null;
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('studentPanel').style.display = 'none';
        return;
    }

    try {
        const userDoc = await firestore.collection('users').doc(user.uid).get();
        if (!userDoc.exists) {
            document.getElementById('loginError').textContent = 'User not found';
            document.getElementById('loginError').style.display = 'block';
            await appAuth.signOut();
            return;
        }

        currentUser = {
            uid: user.uid,
            email: user.email,
            name: userDoc.data().name || user.email
        };

        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('studentPanel').style.display = 'block';
        document.getElementById('userName').textContent = currentUser.name;

        // Load settings
        const settingsDoc = await firestore.collection('settings').doc('appSettings').get();
        if (settingsDoc.exists && settingsDoc.data().testDuration) {
            testDuration = settingsDoc.data().testDuration;
        }

        loadDays();
        loadHistory();
        loadLeaderboard();
    } catch (e) {
        console.error('Auth error:', e);
        document.getElementById('loginError').textContent = 'Error loading user data';
        document.getElementById('loginError').style.display = 'block';
    }
});

async function login() {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const loginError = document.getElementById('loginError');
    loginError.style.display = 'none';

    if (!email || !password) {
        loginError.textContent = 'Please enter email and password';
        loginError.style.display = 'block';
        return;
    }

    try {
        await appAuth.signInWithEmailAndPassword(email, password);
    } catch (err) {
        loginError.textContent = err.message || 'Login failed';
        loginError.style.display = 'block';
    }
}

function logout() {
    if (timerInterval) clearInterval(timerInterval);
    appAuth.signOut();
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });

    event.target.classList.add('active');
    document.getElementById(tabName).classList.add('active');

    if (tabName === 'history') loadHistory();
    if (tabName === 'leaderboard') loadLeaderboard();
}

// Load available days
async function loadDays() {
    const container = document.getElementById('daySelector');
    container.innerHTML = '';

    try {
        // Get completed submissions
        const submissions = await firestore.collection('submissions')
            .where('studentEmail', '==', currentUser.email)
            .get();

        const completedDays = new Set();
        submissions.forEach(function (doc) {
            completedDays.add(doc.data().day);
        });

        // Get schedule
        const now = new Date();
        for (let i = 1; i <= 5; i++) {
            const scheduleDoc = await firestore.collection('schedule').doc('day' + i).get();
            let isOpen = false;
            let openTime = null;

            if (scheduleDoc.exists && scheduleDoc.data().openTime) {
                openTime = scheduleDoc.data().openTime.toDate();
                isOpen = now >= openTime;
            }

            const btn = document.createElement('div');
            btn.className = 'day-btn';

            if (completedDays.has(i)) {
                btn.classList.add('completed');
                btn.innerHTML = '<h3>Day ' + i + '</h3><p>Completed</p>';
                btn.onclick = function () { alert('You have already completed Day ' + i); };
            } else if (!isOpen) {
                btn.classList.add('locked');
                btn.innerHTML = '<h3>Day ' + i + '</h3><p>🔒 Opens ' + (openTime ? formatDate(openTime) : 'TBD') + '</p>';
            } else {
                btn.innerHTML = '<h3>Day ' + i + '</h3><p>Available</p>';
                btn.onclick = function () { startTest(i); };
            }

            container.appendChild(btn);
        }
    } catch (e) {
        console.error('Load days error:', e);
        container.innerHTML = '<p style="color:#dc3545;">Error loading days</p>';
    }
}

function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Start test
async function startTest(day) {
    currentDay = day;
    document.getElementById('testContainer').classList.remove('hidden');

    try {
        // Load question data
        const questionDoc = await firestore.collection('questions').doc('day' + day).get();
        if (!questionDoc.exists) {
            alert('Questions not found for Day ' + day);
            return;
        }

        questionData = questionDoc.data();

        // Check for active test
        const activeTestDoc = await firestore.collection('activeTests').doc(currentUser.uid + '_day' + day).get();
        if (activeTestDoc.exists) {
            activeTest = activeTestDoc.data();
            testStartTime = activeTest.startTime.toDate();
        } else {
            testStartTime = new Date();
            activeTest = {
                startTime: firebase.firestore.Timestamp.fromDate(testStartTime),
                q1Answer: '',
                q2Answer: '',
                q3Answer: '',
                q1Time: 0,
                q2Time: 0,
                q3Time: 0
            };
            await firestore.collection('activeTests').doc(currentUser.uid + '_day' + day).set(activeTest);
        }

        renderQuestions();
        startTimer();
    } catch (e) {
        console.error('Start test error:', e);
        alert('Error starting test: ' + e.message);
    }
}

function renderQuestions() {
    // Instructions
    document.getElementById('instructions').innerHTML = questionData.instructions || 'Complete all questions within the time limit.';

    const container = document.getElementById('questionsContainer');
    let html = '';

    // Q1
    html += '<div class="question-card">';
    html += '<h3>Question 1 (4 points)</h3>';
    html += '<div id="q1Text">' + (questionData.q1Text || '') + '</div>';
    if (questionData.q1Image) {
        html += '<img src="' + questionData.q1Image + '" alt="Q1 Image">';
    }
    html += '<input type="text" class="answer-input" id="q1Answer" placeholder="Enter your answer" value="' + escapeHtml(activeTest.q1Answer || '') + '" onchange="saveProgress()">';
    html += '</div>';

    // Q2
    html += '<div class="question-card">';
    html += '<h3>Question 2 (6 points)</h3>';
    html += '<div id="q2Text">' + (questionData.q2Text || '') + '</div>';
    if (questionData.q2Image) {
        html += '<img src="' + questionData.q2Image + '" alt="Q2 Image">';
    }
    html += '<input type="text" class="answer-input" id="q2Answer" placeholder="Enter your answer" value="' + escapeHtml(activeTest.q2Answer || '') + '" onchange="saveProgress()">';
    html += '</div>';

    // Q3
    html += '<div class="question-card">';
    html += '<h3>Question 3 - Proof (10 points)</h3>';
    html += '<div id="q3Text">' + (questionData.q3Text || '') + '</div>';
    if (questionData.q3Image) {
        html += '<img src="' + questionData.q3Image + '" alt="Q3 Image">';
    }
    html += '<textarea class="answer-input" id="q3Answer" placeholder="Write your proof here. You can use LaTeX notation like $x^2$" onchange="saveProgress()">' + escapeHtml(activeTest.q3Answer || '') + '</textarea>';
    html += '</div>';

    container.innerHTML = html;

    // Typeset MathJax
    if (window.MathJax && window.MathJax.typesetPromise) {
        MathJax.typesetPromise([container]).catch(function () { });
    }
}

function startTimer() {
    const timerDisplay = document.getElementById('timerDisplay');
    timerDisplay.classList.remove('hidden');

    function updateTimer() {
        const elapsed = Math.floor((new Date() - testStartTime) / 1000);
        const remaining = (testDuration * 60) - elapsed;

        if (remaining <= 0) {
            clearInterval(timerInterval);
            submitTest();
            return;
        }

        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        timerDisplay.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

        if (remaining <= 300) {
            timerDisplay.classList.add('warning');
        }
    }

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

async function saveProgress() {
    if (!currentDay || !currentUser) return;

    const q1 = document.getElementById('q1Answer');
    const q2 = document.getElementById('q2Answer');
    const q3 = document.getElementById('q3Answer');

    try {
        await firestore.collection('activeTests').doc(currentUser.uid + '_day' + currentDay).update({
            q1Answer: q1 ? q1.value : '',
            q2Answer: q2 ? q2.value : '',
            q3Answer: q3 ? q3.value : '',
            lastSaved: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('Save progress failed:', e);
    }
}

async function submitTest() {
    if (!currentDay || !currentUser) return;
    if (timerInterval) clearInterval(timerInterval);

    const q1Answer = (document.getElementById('q1Answer')?.value || '').trim();
    const q2Answer = (document.getElementById('q2Answer')?.value || '').trim();
    const q3Answer = (document.getElementById('q3Answer')?.value || '').trim();

    // Check answers
    const q1Correct = q1Answer.toLowerCase() === (questionData.q1Answer || '').toLowerCase();
    const q2Correct = q2Answer.toLowerCase() === (questionData.q2Answer || '').toLowerCase();

    const totalTime = Math.floor((new Date() - testStartTime) / 1000);

    try {
        // Create submission
        await firestore.collection('submissions').add({
            studentEmail: currentUser.email,
            studentName: currentUser.name,
            studentUid: currentUser.uid,
            day: currentDay,
            q1Answer: q1Answer,
            q2Answer: q2Answer,
            q3Answer: q3Answer,
            q1Correct: q1Correct,
            q2Correct: q2Correct,
            totalTime: totalTime,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            gradingStatus: 'pending'
        });

        // Delete active test
        await firestore.collection('activeTests').doc(currentUser.uid + '_day' + currentDay).delete();

        alert('Test submitted successfully!');

        // Reset UI
        document.getElementById('timerDisplay').classList.add('hidden');
        document.getElementById('testContainer').classList.add('hidden');
        currentDay = null;
        loadDays();
        loadHistory();
    } catch (e) {
        console.error('Submit error:', e);
        alert('Error submitting test: ' + e.message);
    }
}

// History
async function loadHistory() {
    const container = document.getElementById('historyContainer');
    container.innerHTML = '<p style="color:#666;">Loading...</p>';

    try {
        const snap = await firestore.collection('submissions')
            .where('studentEmail', '==', currentUser.email)
            .orderBy('timestamp', 'desc')
            .get();

        if (snap.empty) {
            container.innerHTML = '<p style="color:#666;">No submissions yet. Complete a test to see your history.</p>';
            return;
        }

        let html = '';
        snap.forEach(function (doc) {
            const d = doc.data();
            const q1P = d.q1Correct ? 4 : 0;
            const q2P = d.q2Correct ? 6 : 0;
            const q3P = parseInt(d.q3Score || 0);
            const total = q1P + q2P + q3P;
            const maxScore = 20;

            let badgeClass = 'poor';
            if (total >= 16) badgeClass = 'good';
            else if (total >= 10) badgeClass = 'average';

            html += '<div class="history-card">';
            html += '<div class="history-header">';
            html += '<h3>Day ' + d.day + '</h3>';
            html += '<span class="score-badge ' + badgeClass + '">' + total + '/' + maxScore + '</span>';
            html += '</div>';
            html += '<p><strong>Q1:</strong> ' + (d.q1Correct ? 'Correct (+4)' : 'Incorrect') + '</p>';
            html += '<p><strong>Q2:</strong> ' + (d.q2Correct ? 'Correct (+6)' : 'Incorrect') + '</p>';
            html += '<p><strong>Q3:</strong> ' + (d.q3Score !== undefined ? d.q3Score + '/10' : 'Pending grading') + '</p>';

            if (d.q3Feedback) {
                html += '<div class="feedback-box"><h4>Q3 Feedback</h4><div id="feedback_' + doc.id + '">' + d.q3Feedback + '</div></div>';
            } else if (d.gradingStatus === 'pending' || d.gradingStatus === 'assigned') {
                html += '<p style="color:#856404;margin-top:10px;">Q3 feedback pending...</p>';
            }

            html += '</div>';
        });

        container.innerHTML = html;

        // Typeset MathJax for feedback
        if (window.MathJax && window.MathJax.typesetPromise) {
            MathJax.typesetPromise([container]).catch(function () { });
        }
    } catch (e) {
        console.error('Load history error:', e);
        container.innerHTML = '<p style="color:#dc3545;">Error loading history</p>';
    }
}

// Leaderboard
async function loadLeaderboard() {
    const container = document.getElementById('leaderboardContainer');
    container.innerHTML = '<p style="color:#666;">Loading...</p>';

    try {
        const snap = await firestore.collection('submissions').get();

        const byStudent = {};
        snap.forEach(function (doc) {
            const d = doc.data();
            const email = (d.studentEmail || '').toLowerCase();
            if (!byStudent[email]) {
                byStudent[email] = { name: d.studentName || email, total: 0, time: 0, days: 0 };
            }
            byStudent[email].total += (d.q1Correct ? 4 : 0) + (d.q2Correct ? 6 : 0) + parseInt(d.q3Score || 0);
            byStudent[email].time += d.totalTime || 0;
            byStudent[email].days++;
        });

        const arr = Object.values(byStudent).sort(function (a, b) {
            return b.total - a.total || a.time - b.time;
        });

        if (arr.length === 0) {
            container.innerHTML = '<p style="color:#666;">No entries yet.</p>';
            return;
        }

        let html = '<table class="leaderboard-table"><thead><tr><th>Rank</th><th>Name</th><th>Total Score</th><th>Days</th></tr></thead><tbody>';
        arr.forEach(function (entry, i) {
            let rowClass = '';
            if (i === 0) rowClass = 'rank-1';
            else if (i === 1) rowClass = 'rank-2';
            else if (i === 2) rowClass = 'rank-3';

            html += '<tr class="' + rowClass + '">';
            html += '<td>' + (i + 1) + '</td>';
            html += '<td>' + escapeHtml(entry.name) + '</td>';
            html += '<td>' + entry.total + '</td>';
            html += '<td>' + entry.days + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';

        container.innerHTML = html;
    } catch (e) {
        console.error('Load leaderboard error:', e);
        container.innerHTML = '<p style="color:#dc3545;">Error loading leaderboard</p>';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
