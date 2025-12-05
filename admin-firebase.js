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

// Cache admin emails so admin accounts aren't treated as students in lists
async function getAdminEmails() {
    if (window._dpotd_adminEmails) return window._dpotd_adminEmails;
    const set = new Set();
    try {
        const snap = await firestore.collection('users').where('isAdmin', '==', true).get();
        snap.forEach(doc => {
            const e = doc.data().email;
            if (e) set.add(e.toLowerCase());
        });
        window._dpotd_adminEmails = set;
    } catch (e) {
        console.warn('getAdminEmails failed', e);
    } 
    try {
        const settingsDoc = await firestore.collection('settings').doc('appSettings').get();
        if (settingsDoc.exists) {
            const adminEmail = settingsDoc.data().adminEmail;
            if (adminEmail) set.add(adminEmail.toLowerCase());
        }
    } catch (e) {
        // ignore
    }
    return set;
}

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
    // Remove active from all tabs and contents
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    // Mark the button with matching data-tab as active (added to HTML)
    const btn = document.querySelector(`.tab[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');
    const content = document.getElementById(tabName);
    if (content) content.classList.add('active');

    if (tabName === 'questions') loadQuestions();
    if (tabName === 'schedule') loadSchedule();
    if (tabName === 'settings') loadSettings();
    if (tabName === 'users') loadUsers();
    if (tabName === 'submissions') loadSubmissions();
    if (tabName === 'leaderboard') loadLeaderboard();
}

// --- Leaderboard display state (new) ---
let adminLeaderboardCache = []; // aggregated cache (legacy, may be unused)
let rawSubmissions = [];        // raw submission docs for dynamic aggregation
let leaderboardExpanded = false;
let leaderboardColFilters = {
    q1: true,
    q2: true,
    q3: true,
    nonproof: true,
    proof: true,
    total: true,
    completedDays: true,
    totalTime: true
};
let leaderboardDayFilter = 'all'; // 'all' or numeric day

// Leaderboard UI state: search, sort, pagination
let leaderboardSearch = '';
let leaderboardSort = { col: 'totalScore', dir: 'desc' };
let leaderboardPage = 1;
let leaderboardPageSize = 50;

// Replace/augment loadLeaderboard to fetch full submission details (answers + per-question times)
async function loadLeaderboard() {
    if (!isAuthenticated) return;
    const container = document.getElementById('leaderboardContainer');
    if (container) container.innerHTML = '<p style="color:#666; text-align:center;">Loading leaderboard...</p>';
    try {
        const adminEmails = await getAdminEmails();
        const snap = await firestore.collection('submissions').get();
        // include detailed fields so we can compute per-day/per-question stats and show raw answers
        rawSubmissions = snap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                day: d.day,
                studentName: d.studentName || '',
                studentEmail: (d.studentEmail || '').toLowerCase(),
                q1Correct: !!d.q1Correct,
                q2Correct: !!d.q2Correct,
                q3Score: parseInt(d.q3Score || 0) || 0,
                q1Time: d.q1Time || 0,
                q2Time: d.q2Time || 0,
                q3Time: d.q3Time || 0,
                totalTime: d.totalTime || 0,
                q1Answer: d.q1Answer || '',
                q2Answer: d.q2Answer || '',
                q3Answer: d.q3Answer || '',
                exitCount: d.exitCount || 0,
                exitLogs: Array.isArray(d.exitLogs) ? d.exitLogs : (d.exitLogs ? JSON.parse(d.exitLogs || '[]') : [])
            };
        }).filter(s => {
            const em = s.studentEmail || '';
            return !(adminEmails && adminEmails.has(em));
        });

        adminLeaderboardCache = []; // not used directly; we recompute each render
        // Reset pagination/search when loading fresh data
        leaderboardPage = 1;
        renderLeaderboardTable();
    } catch (error) {
        if (container) container.innerHTML = '<p style="color:#dc3545; text-align:center;">Leaderboard unavailable (permissions)</p>';
        console.error('loadLeaderboard failed', error);
    }
}

// Render the leaderboard table including per-day columns and per-student details
function renderLeaderboardTable() {
    const container = document.getElementById('leaderboardContainer');
    if (!container) return;
    const raw = rawSubmissions || [];
    if (raw.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666;">No submissions yet.</p>';
        return;
    }

    // Aggregate per student (and per-day inside each student)
    const byStudent = {};
    raw.forEach(s => {
        if (leaderboardDayFilter !== 'all' && String(s.day) !== String(leaderboardDayFilter)) return;
        const em = s.studentEmail || '';
        if (!byStudent[em]) byStudent[em] = { name: s.studentName || em, email: em, perDay: {}, q1Points: 0, q2Points: 0, q3Points: 0, totalTime: 0, completedDays: 0, exitCount: 0 };
        const st = byStudent[em];
        const dayKey = String(s.day || '0');
        if (!st.perDay[dayKey]) st.perDay[dayKey] = { q1Points: 0, q2Points: 0, q3Points:0, q1Time:0, q2Time:0, q3Time:0, totalTime:0, q1Answer:'', q2Answer:'', q3Answer:'', exitCount:0, exitLogs:[] };
        const pd = st.perDay[dayKey];

        const q1p = s.q1Correct ? 5 : 0;
        const q2p = s.q2Correct ? 5 : 0;
        const q3p = s.q3Score || 0;

        pd.q1Points += q1p;
        pd.q2Points += q2p;
        pd.q3Points += q3p;
        pd.q1Time += s.q1Time || 0;
        pd.q2Time += s.q2Time || 0;
        pd.q3Time += s.q3Time || 0;
        pd.totalTime += s.totalTime || 0;
        pd.q1Answer = pd.q1Answer || s.q1Answer || '';
        pd.q2Answer = pd.q2Answer || s.q2Answer || '';
        pd.q3Answer = pd.q3Answer || s.q3Answer || '';
        pd.exitCount += s.exitCount || 0;
        pd.exitLogs = pd.exitLogs.concat(s.exitLogs || []);

        st.q1Points += q1p;
        st.q2Points += q2p;
        st.q3Points += q3p;
        st.totalTime += s.totalTime || 0;
        st.completedDays = Object.keys(st.perDay).length;
        st.exitCount += s.exitCount || 0;
    });

    // Convert to array and compute derived totals
    let aggregated = Object.values(byStudent).map(st => {
        const nonproof = (st.q1Points || 0) + (st.q2Points || 0);
        const proof = st.q3Points || 0;
        const total = nonproof + proof;
        return { ...st, nonproofPoints: nonproof, proofPoints: proof, totalScore: total };
    });

    // Apply search filter (name or email)
    const s = (leaderboardSearch || '').trim().toLowerCase();
    if (s) aggregated = aggregated.filter(r => (r.name || '').toLowerCase().includes(s) || (r.email || '').toLowerCase().includes(s));

    // Sort
    const col = leaderboardSort.col;
    const dir = leaderboardSort.dir === 'asc' ? 1 : -1;
    aggregated.sort((a,b) => {
        const va = (a[col] !== undefined && a[col] !== null) ? a[col] : 0;
        const vb = (b[col] !== undefined && b[col] !== null) ? b[col] : 0;
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
    });

    // Pagination
    const totalItems = aggregated.length;
    const pageSize = leaderboardPageSize;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (leaderboardPage > totalPages) leaderboardPage = totalPages;
    const startIdx = (leaderboardPage - 1) * pageSize;
    const pageData = aggregated.slice(startIdx, startIdx + pageSize);

    // Build headers: if expanded, show per-day group columns (Day1..Day5 -> Q1,Q2,Q3,Time), otherwise compact
    function th(label, key, visible = true) {
        const active = leaderboardSort.col === key;
        const dirArrow = active ? (leaderboardSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
        const cls = active ? 'sortable-active' : 'sortable';
        return visible ? `<th style="padding:10px;cursor:pointer" onclick="setLeaderboardSort('${key}')"><span class="${cls}">${label}${dirArrow}</span></th>` : '';
    }

    // NOTE: removed the Email column here to avoid displaying student emails.
    let headers = `<th style="padding:12px;">Rank</th><th style="padding:12px;">Name</th>`;
    if (leaderboardExpanded) {
        // for days 1..5
        for (let d=1; d<=5; d++) {
            headers += `<th style="padding:8px;text-align:center;">D${d} Q1</th><th style="padding:8px;text-align:center;">D${d} Q2</th><th style="padding:8px;text-align:center;">D${d} Q3</th><th style="padding:8px;text-align:center;">D${d} Time(s)</th>`;
        }
        headers += th('Non-Proof','nonproofPoints', leaderboardColFilters.nonproof);
        headers += th('Proof','proofPoints', leaderboardColFilters.proof);
        headers += th('Total','totalScore', leaderboardColFilters.total);
        headers += th('Total Time(s)','totalTime', leaderboardColFilters.totalTime);
        headers += th('Days','completedDays', leaderboardColFilters.completedDays);
        headers += `<th style="padding:12px;">Details</th>`;
    } else {
        headers += th('Total Score', 'totalScore', true);
        headers += th('Non-Proof','nonproofPoints', true);
        headers += th('Proof','proofPoints', true);
        headers += th('Total Time(s)', 'totalTime', true);
        headers += `<th style="padding:12px;">Details</th>`;
    }

    // Build rows with a toggleable details section per student
    let rows = '';
    pageData.forEach((entry, idx) => {
        const rank = startIdx + idx + 1;
        const safeId = 'studentDetails_' + (entry.email || '').replace(/[^a-z0-9]/gi, '_');
        if (leaderboardExpanded) {
            rows += `<tr>
                <td style="padding:10px;border-bottom:1px solid #e9ecef;">${rank}</td>
                <td style="padding:10px;border-bottom:1px solid #e9ecef;">${escapeHtml(entry.name)}</td>`;
            for (let d=1; d<=5; d++) {
                const pd = entry.perDay[String(d)] || {};
                rows += `<td style="padding:8px;text-align:center;border-bottom:1px solid #e9ecef;">${pd.q1Points || 0}</td>`;
                rows += `<td style="padding:8px;text-align:center;border-bottom:1px solid #e9ecef;">${pd.q2Points || 0}</td>`;
                rows += `<td style="padding:8px;text-align:center;border-bottom:1px solid #e9ecef;">${pd.q3Points || 0}</td>`;
                rows += `<td style="padding:8px;text-align:center;border-bottom:1px solid #e9ecef;">${pd.totalTime || 0}</td>`;
            }
            rows += `<td style="padding:10px;border-bottom:1px solid #e9ecef;">${entry.nonproofPoints}</td>`;
            rows += `<td style="padding:10px;border-bottom:1px solid #e9ecef;">${entry.proofPoints}</td>`;
            rows += `<td style="padding:10px;border-bottom:1px solid #e9ecef;">${entry.totalScore}</td>`;
            rows += `<td style="padding:10px;border-bottom:1px solid #e9ecef;">${entry.totalTime}</td>`;
            rows += `<td style="padding:10px;border-bottom:1px solid #e9ecef;">${entry.completedDays}</td>`;
            rows += `<td style="padding:10px;border-bottom:1px solid #e9ecef;"><button class="btn-secondary" onclick="toggleStudentDetails('${safeId}')">Toggle</button></td>`;
            rows += `</tr>`;
            // details row (hidden by default)
            // updated colspan: removed Email column so colspan = 2 (Rank+Name) + 4*5 + 6 = 28
            rows += `<tr id="${safeId}" style="display:none;"><td colspan="${(2 + 4*5 + 6)}" style="padding:12px;background:#fafafa;">${renderStudentDetailHtml(entry)}</td></tr>`;
        } else {
            rows += `<tr>
                <td style="padding:10px;border-bottom:1px solid #e9ecef;">${rank}</td>
                <td style="padding:10px;border-bottom:1px solid #e9ecef;">${escapeHtml(entry.name)}</td>
                <td style="padding:10px;border-bottom:1px solid #e9ecef;">${entry.totalScore}</td>
                <td style="padding:10px;border-bottom:1px solid #e9ecef;">${entry.nonproofPoints}</td>
                <td style="padding:10px;border-bottom:1px solid #e9ecef;">${entry.proofPoints}</td>
                <td style="padding:10px;border-bottom:1px solid #e9ecef;">${entry.totalTime}</td>
                <td style="padding:10px;border-bottom:1px solid #e9ecef;"><button class="btn-secondary" onclick="toggleStudentDetails('${safeId}')">Toggle</button></td>
            </tr>`;
            // compact view details colspan updated (no Email column): 7 columns
            rows += `<tr id="${safeId}" style="display:none;"><td colspan="7" style="padding:12px;background:#fafafa;">${renderStudentDetailHtml(entry)}</td></tr>`;
        }
    });

    // Pagination controls
    const prevDisabled = leaderboardPage <= 1 ? 'disabled' : '';
    const nextDisabled = leaderboardPage >= totalPages ? 'disabled' : '';
    const paginationHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:10px;flex-wrap:wrap;">
            <div style="font-size:13px;color:#666;">Showing ${startIdx + 1}-${Math.min(startIdx + pageSize, totalItems)} of ${totalItems}</div>
            <div style="display:flex;gap:8px;align-items:center;">
                <button class="btn" onclick="setLeaderboardPage(${Math.max(1, leaderboardPage - 1)})" ${prevDisabled} style="padding:8px 12px;">Prev</button>
                <span style="font-weight:600;">Page ${leaderboardPage} / ${totalPages}</span>
                <button class="btn" onclick="setLeaderboardPage(${Math.min(totalPages, leaderboardPage + 1)})" ${nextDisabled} style="padding:8px 12px;">Next</button>
            </div>
        </div>
    `;

    container.innerHTML = `
        <div style="overflow:auto; max-height: 600px;">
            <table class="leaderboard-table" style="width:100%;border-collapse:collapse;">
                <thead style="position: sticky; top: 0; z-index: 5;"> <tr>${headers}</tr> </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${paginationHTML}
    `;
}

// helper to render the detailed HTML for a student (per-day raw answers, times, exit logs)
function renderStudentDetailHtml(entry) {
    // entry.perDay is a map day -> stats
    let html = `<div style="display:block;"><h4 style="margin-bottom:10px;">Detailed per-day breakdown for ${escapeHtml(entry.name)}</h4>`;
    // NOTE: remove displaying student answers. Only show per-question points, times, total time, and exit info.
    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:10px;"><thead><tr style="background:#f1f1f1;"><th style="padding:8px">Day</th><th style="padding:8px">Q1Pts</th><th style="padding:8px">Q1Time(s)</th><th style="padding:8px">Q2Pts</th><th style="padding:8px">Q2Time(s)</th><th style="padding:8px">Q3Pts</th><th style="padding:8px">Q3Time(s)</th><th style="padding:8px">TotalTime(s)</th><th style="padding:8px">ExitCount</th></tr></thead><tbody>`;
    for (let d=1; d<=5; d++) {
        const pd = entry.perDay[String(d)];
        if (!pd) {
            // colspan now 9 (matching header columns)
            html += `<tr><td style="padding:8px">Day ${d}</td><td style="padding:8px" colspan="8" style="color:#666;">No submission</td></tr>`;
        } else {
            html += `<tr>
                <td style="padding:8px">Day ${d}</td>
                <td style="padding:8px">${pd.q1Points || 0}</td>
                <td style="padding:8px">${pd.q1Time || 0}</td>
                <td style="padding:8px">${pd.q2Points || 0}</td>
                <td style="padding:8px">${pd.q2Time || 0}</td>
                <td style="padding:8px">${pd.q3Points || 0}</td>
                <td style="padding:8px">${pd.q3Time || 0}</td>
                <td style="padding:8px">${pd.totalTime || 0}</td>
                <td style="padding:8px">${pd.exitCount || 0}</td>
            </tr>`;
            if (pd.exitLogs && pd.exitLogs.length) {
                html += `<tr><td style="padding:8px" colspan="9"><strong style="color:#dc3545">Exit Logs:</strong> ${pd.exitLogs.map(l=>escapeHtml(l.time + ' - ' + l.type)).join(' ; ')}</td></tr>`;
            }
        }
    }
    html += `</tbody></table>`;
    html += `<div style="margin-top:8px;"><strong>Totals:</strong> Non-proof: ${entry.nonproofPoints} • Proof: ${entry.proofPoints} • Total: ${entry.totalScore} • Time: ${entry.totalTime}s • Days: ${entry.completedDays}</div>`;
    html += `</div>`;
    return html;
}

// helper to toggle student details row
function toggleStudentDetails(safeId) {
    const el = document.getElementById(safeId);
    if (!el) return;
    el.style.display = (el.style.display === 'none' || !el.style.display) ? 'table-row' : 'none';
}

// -------------------- Questions --------------------
async function loadQuestions() {
    if (!isAuthenticated) return;

    const day = document.getElementById('questionDay').value;
    const statusEl = document.getElementById('questionStatus');
    if (statusEl) statusEl.style.display = 'none';

    try {
        const doc = await firestore.collection('questions').doc(`day${day}`).get();
        const data = doc.exists ? doc.data() : {};

        // load instructions
        const instrEl = document.getElementById('instructions');
        if (instrEl) instrEl.value = data.instructions || '';

        const q1TextEl = document.getElementById('q1Text');
        if (q1TextEl) q1TextEl.value = data.q1Text || '';
        const q1AnswerEl = document.getElementById('q1Answer');
        if (q1AnswerEl) q1AnswerEl.value = data.q1Answer || '';
        if (data.q1Image) {
            const q1ImageData = document.getElementById('q1ImageData');
            const q1Preview = document.getElementById('q1ImagePreview');
            if (q1ImageData) q1ImageData.value = data.q1Image;
            if (q1Preview) q1Preview.innerHTML = `<img src="${data.q1Image}" alt="Question 1 Image">`;
        }

        const q2TextEl = document.getElementById('q2Text');
        if (q2TextEl) q2TextEl.value = data.q2Text || '';
        const q2AnswerEl = document.getElementById('q2Answer');
        if (q2AnswerEl) q2AnswerEl.value = data.q2Answer || '';
        if (data.q2Image) {
            const q2ImageData = document.getElementById('q2ImageData');
            const q2Preview = document.getElementById('q2ImagePreview');
            if (q2ImageData) q2ImageData.value = data.q2Image;
            if (q2Preview) q2Preview.innerHTML = `<img src="${data.q2Image}" alt="Question 2 Image">`;
        }

        const q3TextEl = document.getElementById('q3Text');
        if (q3TextEl) q3TextEl.value = data.q3Text || '';
        const q3AnswerEl = document.getElementById('q3Answer');
        if (q3AnswerEl) q3AnswerEl.value = data.q3Answer || '';
        if (data.q3Image) {
            const q3ImageData = document.getElementById('q3ImageData');
            const q3Preview = document.getElementById('q3ImagePreview');
            if (q3ImageData) q3ImageData.value = data.q3Image;
            if (q3Preview) q3Preview.innerHTML = `<img src="${data.q3Image}" alt="Question 3 Image">`;
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
        instructions: (document.getElementById('instructions') && document.getElementById('instructions').value) || '',
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
        showStatus('questionStatus', 'Questions saved.', 'success');
    } catch (error) {
        showStatus('questionStatus', 'Error saving questions: ' + error.message, 'error');
    }
}

// -------------------- Schedule --------------------
async function loadSchedule() {
    if (!isAuthenticated) return;
    const statusEl = document.getElementById('scheduleStatus');
    if (statusEl) statusEl.style.display = 'none';

    try {
        for (let i = 1; i <= 5; i++) {
            const doc = await firestore.collection('schedule').doc(`day${i}`).get();
            const data = doc.exists ? doc.data() : {};
            const openTime = data.openTime ? data.openTime.toDate() : null;
            const el = document.getElementById(`day${i}`);
            if (el) el.value = formatDateTimeLocal(openTime);
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
            const valEl = document.getElementById(`day${i}`);
            if (!valEl) continue;
            const val = valEl.value;
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
    if (statusEl) statusEl.style.display = 'none';

    try {
        const doc = await firestore.collection('settings').doc('appSettings').get();
        const data = doc.exists ? doc.data() : {};
        const td = document.getElementById('testDuration');
        if (td) td.value = data.testDuration || 120;
        const an = document.getElementById('adminName');
        if (an) an.value = data.adminName || '';
        const ae = document.getElementById('adminEmail');
        if (ae) ae.value = data.adminEmail || '';
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
    if (container) container.innerHTML = '<p style="color: #666;">Loading users...</p>';

    try {
        const snapshot = await firestore.collection('users').get();
        if (snapshot.empty) {
            if (container) container.innerHTML = '<p style="color: #666;">No users found.</p>';
            return;
        }

        if (container) container.innerHTML = '';
        snapshot.forEach(doc => {
            const user = doc.data();
            const card = document.createElement('div');
            card.className = 'submission-card';
            // include data-email attribute so the hide-admin script can match
            card.dataset.email = (user.email || '').toLowerCase();
            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <h3 style="margin:0 0 6px 0;">${user.name || 'Unknown'}</h3>
                        <p style="color:#666;">${user.email || ''}</p>
                        <p style="color:#666; font-size:14px;">Created: ${user.createdAt ? user.createdAt.toDate().toLocaleString() : 'N/A'}</p>
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
    const tempPassword = name + Math.random().toString(36).substring(2, 6);

    if (!name || !email) {
        alert('Please fill name and email');
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
        alert('User created. A set-password email was sent.');
    } catch (error) {
        alert('Error creating user: ' + error.message);
    }
    loadUsers();
}

async function deleteUser(userId) {
    if (!confirm('Delete this user record? (Remove the auth account separately in your auth console.)')) return;
    try {
        await firestore.collection('users').doc(userId).delete();
        alert('User record deleted. Remember to remove the auth user in your auth console.');
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
    if (container) container.innerHTML = '<p style="color: #666;">Loading submissions...</p>';

    try {
        const snapshot = await firestore.collection('submissions').orderBy('timestamp', 'desc').get();
        const adminEmails = await getAdminEmails();
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
        }).filter(s => {
            const em = (s.studentEmail || '').toLowerCase();
            return !(adminEmails && adminEmails.has(em));
        });

        cachedSubmissions = submissions;

        if (submissions.length === 0) {
            if (container) container.innerHTML = '<p style="color: #666; text-align: center; padding: 40px;">No submissions yet.</p>';
            const nav = document.getElementById('navControls');
            if (nav) nav.style.display = 'none';
            return;
        }

        // Populate filters
        const studentFilter = document.getElementById('filterStudent');
        const uniqueStudents = [...new Set(submissions.map(s => s.studentEmail))];
        if (studentFilter) {
            studentFilter.innerHTML = '<option value="all">All Students</option>';
            uniqueStudents.forEach(email => {
                const sub = submissions.find(s => s.studentEmail === email);
                const opt = document.createElement('option');
                opt.value = email;
                opt.textContent = `${sub.studentName} (${email})`;
                studentFilter.appendChild(opt);
            });
        }

        filterSubmissions();
    } catch (error) {
        showStatus('submissionsStatus', 'Error loading submissions: ' + error.message, 'error');
        if (container) container.innerHTML = '<p style="color: #dc3545; text-align: center; padding: 40px;">Error loading submissions</p>';
    }
}

function filterSubmissions() {
    const dayFilter = (document.getElementById('filterDay') && document.getElementById('filterDay').value) || 'all';
    const studentFilter = (document.getElementById('filterStudent') && document.getElementById('filterStudent').value) || 'all';

    filteredSubmissions = cachedSubmissions.filter(sub => {
        const dayMatch = dayFilter === 'all' || sub.day == dayFilter;
        const studentMatch = studentFilter === 'all' || sub.studentEmail === studentFilter;
        return dayMatch && studentMatch;
    });

    if (filteredSubmissions.length === 0) {
        const container = document.getElementById('submissionsContainer');
        if (container) container.innerHTML = '<p style="color: #666; text-align: center; padding: 40px;">No submissions match the filters.</p>';
        const nav = document.getElementById('navControls');
        if (nav) nav.style.display = 'none';
        return;
    }

    currentSubmissionIndex = 0;
    populateSubmissionSelector();
    const nav = document.getElementById('navControls');
    if (nav) nav.style.display = 'flex';
    displayCurrentSubmission();
}

function populateSubmissionSelector() {
    const selector = document.getElementById('submissionSelector');
    if (!selector) return;
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
    const sel = document.getElementById('submissionSelector');
    if (!sel) return;
    currentSubmissionIndex = parseInt(sel.value, 10);
    displayCurrentSubmission();
}

function navigateSubmission(direction) {
    currentSubmissionIndex += direction;
    if (currentSubmissionIndex < 0) currentSubmissionIndex = 0;
    if (currentSubmissionIndex >= filteredSubmissions.length) currentSubmissionIndex = filteredSubmissions.length - 1;

    const sel = document.getElementById('submissionSelector');
    if (sel) sel.value = currentSubmissionIndex;
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
    if (!sub || !container) return;

    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (prevBtn) prevBtn.disabled = currentSubmissionIndex === 0;
    if (nextBtn) nextBtn.disabled = currentSubmissionIndex === filteredSubmissions.length - 1;

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
                <div class="q3-header">
                    <h3>Q3 Answer (LaTeX)</h3>
                    <div class="q3-meta">
                        <span class="feedback-time">Time: ${formatTime(sub.q3_time || 0)}</span>
                    </div>
                </div>
                <div class="latex-editor-container">
                    <div class="latex-input-section">
                        <h4>Score (0-10)</h4>
                        <input type="number" id="score_${rowKey}" min="0" max="10" step="1" value="${sub.q3_score || ''}" style="margin-bottom: 10px;">
                        <h4>Feedback (LaTeX)</h4>
                        <textarea id="feedback_latex_${rowKey}" oninput="updateLatexPreview('${rowKey}')" placeholder="Write LaTeX feedback...">${sub.q3_feedback || ''}</textarea>
                    </div>
                    <div class="latex-preview-section">
                        <h4>Preview</h4>
                        <div id="feedback_preview_${rowKey}" class="preview-content">${sub.q3_feedback || '<p style="color:#999;">Preview will render here</p>'}</div>
                    </div>
                </div>
                <div class="feedback-actions">
                    <button class="btn" onclick="saveFeedback('${rowKey}')">Save Feedback &amp; Notify</button>
                    <span class="feedback-time">Score currently: ${sub.q3_score === '' || sub.q3_score === null || sub.q3_score === undefined ? 'Not set' : sub.q3_score + '/10'}</span>
                </div>
            </div>
            <div class="question-group">
                <h3>Exit Logs</h3>
                ${exitLogs.length === 0 ? '<p style="color:#666;">No violations recorded</p>' : `<div class="exit-log-list">${exitLogs.map(log => `<p>• ${log.time} – ${log.type}</p>`).join('')}</div>`}
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

// small helper: format Date -> "YYYY-MM-DDTHH:MM" for input[type=datetime-local]
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

// Image upload helper (used by admin.html onchange handlers)
// slot: 1 | 2 | 3
async function handleImageUpload(slot) {
    try {
        const fileInput = document.getElementById(`q${slot}Image`);
        const dataInput = document.getElementById(`q${slot}ImageData`);
        const preview = document.getElementById(`q${slot}ImagePreview`);
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            if (dataInput) dataInput.value = dataUrl;
            if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="Question ${slot} Image">`;
        };
        reader.readAsDataURL(file);
    } catch (e) {
        console.error('handleImageUpload error', e);
        alert('Image upload failed. Try a smaller image or different format.');
    }
}

// small helper to escape HTML used in dynamic inputs/rendering
function escapeHtml(str) {
	if (str === undefined || str === null) return '';
	return String(str).replace(/[&<>"'`=\/]/g, function (s) {
		return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '=': '&#x3D;', '`': '&#x60;' }[s]);
	});
}

// helper: set sort column/direction when header clicked
function setLeaderboardSort(col) {
	// toggle direction if same column, otherwise choose sensible default
	if (leaderboardSort.col === col) {
		leaderboardSort.dir = leaderboardSort.dir === 'asc' ? 'desc' : 'asc';
	} else {
		leaderboardSort.col = col;
		// for time we prefer ascending by default, for scores descending
		leaderboardSort.dir = (col === 'totalTime') ? 'asc' : 'desc';
	}
	leaderboardPage = 1;
	renderLeaderboardTable();
}
