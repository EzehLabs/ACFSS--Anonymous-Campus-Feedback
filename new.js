const dashboardApiUrl = 'http://localhost:3000';

function checkAuth() {
    const token = localStorage.getItem('authToken');
    const adminInfoText = localStorage.getItem('adminInfo');

    if (!token || !adminInfoText) {
        window.location.href = 'admin.html';
        return null;
    }

    try {
        return { token, adminInfo: JSON.parse(adminInfoText) };
    } catch (error) {
        console.error('Invalid admin info:', error);
        window.location.href = 'admin.html';
        return null;
    }
}

const auth = checkAuth();
if (!auth) {
    throw new Error('Authentication required');
}

let currentComplaints = [];

function updateAdminDisplay() {
    const adminInfo = auth.adminInfo;
    const adminName = document.getElementById('adminName');
    const adminEmail = document.getElementById('adminEmail');
    const adminBadge = document.getElementById('adminBadge');

    if (adminName) adminName.textContent = adminInfo.name || 'Admin';
    if (adminEmail) adminEmail.textContent = adminInfo.email || '';
    if (adminBadge) adminBadge.textContent = adminInfo.can_create_admins ? '@ SUPER ADMIN' : '@ ADMIN';
}

updateAdminDisplay();

function showComplaintDetails(id, { showActions = false } = {}) {
    const complaint = currentComplaints.find(item => item.id === id);
    const detailsPanel = document.getElementById('bigxDetails');
    if (!complaint || !detailsPanel) return;

    document.querySelectorAll('#complaintsContainer .queue-card').forEach(card => {
        card.classList.toggle('selected', Number(card.dataset.complaintId) === id);
    });

    document.querySelectorAll('#complaintsTable .table-row').forEach(row => {
        row.classList.toggle('selected', Number(row.dataset.complaintId) === id);
    });

    detailsPanel.innerHTML = `
        <article class="detail-card complaint-detail-card">
            <div class="queue-header complaint-detail-header">
                <span class="queue-tag complaint-reference">${complaint.reference_code}</span>
                <span class="queue-date complaint-date">${new Date(complaint.submitted_at).toLocaleString()}</span>
            </div>
            <h3 class="queue-title complaint-category">${complaint.category}</h3>
            <p class="queue-copy complaint-description">${complaint.content}</p>
            <div class="complaint-detail-summary" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 18px;">
                <div class="complaint-detail-field"><strong>Status</strong><p>${complaint.status}</p></div>
                <div class="complaint-detail-field"><strong>Priority</strong><p>${complaint.priority}</p></div>
                <div class="complaint-detail-field"><strong>Sentiment</strong><p>${complaint.sentiment}</p></div>
                <div class="complaint-detail-field"><strong>Reference</strong><p>${complaint.reference_code}</p></div>
            </div>
        </article>
    `;

    renderComplaintActions(complaint, showActions);
}

function updateStats(complaints) {
    const totalFiled = complaints.length;
    const unreviewedCount = complaints.filter(c => c.status === 'Unreviewed').length;
    const urgentCount = complaints.filter(c => {
        const priority = (c.priority || '').toLowerCase();
        return priority === 'high' || priority === 'urgent';
    }).length;
    const resolvedCount = complaints.filter(c => (c.status || '').toLowerCase() === 'resolved').length;

    const totalFiledEl = document.getElementById('totalFiled');
    const unreviewedEl = document.getElementById('unreviewed');
    const urgentEl = document.getElementById('urgent');
    const resolvedEl = document.getElementById('resolved');

    if (totalFiledEl) totalFiledEl.textContent = totalFiled;
    if (unreviewedEl) unreviewedEl.textContent = unreviewedCount;
    if (urgentEl) urgentEl.textContent = urgentCount;
    if (resolvedEl) resolvedEl.textContent = resolvedCount;
}

function populateFilters(complaints) {
    const categoryFilter = document.getElementById('categoryFilter');
    const statusFilter = document.getElementById('statusFilter');
    const priorityFilter = document.getElementById('priorityFilter');
    const sentimentFilter = document.getElementById('sentimentFilter');

    if (!categoryFilter || !statusFilter || !priorityFilter || !sentimentFilter) return;

    const categories = ['All Categories', ...new Set(complaints.map(c => c.category || ''))];
    const statuses = ['All Statuses', ...new Set(complaints.map(c => c.status || ''))];
    const priorities = ['All Priorities', ...new Set(complaints.map(c => c.priority || ''))];
    const sentiments = ['All Sentiments', ...new Set(complaints.map(c => c.sentiment || ''))];

    categoryFilter.innerHTML = categories.map(category => `<option value="${category}">${category}</option>`).join('');
    statusFilter.innerHTML = statuses.map(status => `<option value="${status}">${status}</option>`).join('');
    priorityFilter.innerHTML = priorities.map(priority => `<option value="${priority}">${priority}</option>`).join('');
    sentimentFilter.innerHTML = sentiments.map(sentiment => `<option value="${sentiment}">${sentiment}</option>`).join('');
}

function safeText(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attachTableEvents() {
    document.querySelectorAll('#complaintsTable .table-row').forEach(row => {
        row.addEventListener('click', () => {
            const complaintId = Number(row.dataset.complaintId);
            showComplaintDetails(complaintId, { showActions: false });
            document.querySelectorAll('#complaintsTable .table-row').forEach(r => {
                r.classList.toggle('selected', Number(r.dataset.complaintId) === complaintId);
            });
        });
    });
}

function renderComplaintTable(complaints) {
    const tableBody = document.getElementById('complaintsTable');
    if (!tableBody) return;

    if (!complaints || complaints.length === 0) {
        tableBody.innerHTML = `
            <div class="table-row alternate">
                <div style="grid-column: 1 / -1; padding: 22px; color: #64748b; text-align: center;">No matching complaints found.</div>
            </div>
        `;
        return;
    }

    tableBody.innerHTML = complaints.map(complaint => `
        <div class="table-row" data-complaint-id="${complaint.id}">
            <div>${safeText(complaint.reference_code)}</div>
            <div>${safeText(complaint.category)}</div>
            <div>${safeText((complaint.content || '').substring(0, 80))}${(complaint.content || '').length > 80 ? '...' : ''}</div>
            <div>${safeText(complaint.status)}</div>
            <div>${safeText(complaint.priority)}</div>
            <div>${safeText(complaint.sentiment)}</div>
            <div>${new Date(complaint.submitted_at).toLocaleDateString()}</div>
        </div>
    `).join('');

    attachTableEvents();
}

function renderNotifications(allComplaints) {
    const container = document.getElementById('complaintsContainer');
    if (!container) return;
    const notifications = (allComplaints || []).filter(c => {
        const status = (c.status || '').toLowerCase();
        return status !== 'resolved' && status !== 'discarded';
    });

    if (notifications.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No notifications</p>';
        return;
    }

    container.innerHTML = notifications.map(complaint => `
        <article class="queue-card" data-complaint-id="${complaint.id}">
            <div class="queue-header">
                <span class="queue-tag">Quarantine Item</span>
                <span class="queue-date">${new Date(complaint.submitted_at).toLocaleDateString()}</span>
            </div>
            <h3 class="queue-title">${safeText(complaint.reference_code)} � ${safeText(complaint.category)}</h3>
            <p class="queue-copy">${safeText((complaint.content || '').substring(0, 120))}${(complaint.content || '').length > 120 ? '...' : ''}</p>
        </article>
    `).join('');

    document.querySelectorAll('#complaintsContainer .queue-card').forEach(card => {
        card.addEventListener('click', () => {
            const complaintId = Number(card.dataset.complaintId);
            showComplaintDetails(complaintId, { showActions: true });
        });
    });
}

function applyTableFilters() {
    const query = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
    const category = document.getElementById('categoryFilter')?.value || 'All Categories';
    const status = document.getElementById('statusFilter')?.value || 'All Statuses';
    const priority = document.getElementById('priorityFilter')?.value || 'All Priorities';
    const sentiment = document.getElementById('sentimentFilter')?.value || 'All Sentiments';
    const sort = document.getElementById('sortSelect')?.value || 'newest';

    let results = currentComplaints.slice();

    if (category !== 'All Categories') {
        results = results.filter(c => (c.category || '') === category);
    }
    if (status !== 'All Statuses') {
        results = results.filter(c => (c.status || '') === status);
    }
    if (priority !== 'All Priorities') {
        results = results.filter(c => (c.priority || '') === priority);
    }
    if (sentiment !== 'All Sentiments') {
        results = results.filter(c => (c.sentiment || '') === sentiment);
    }
    if (query) {
        results = results.filter(c =>
            (c.reference_code || '').toLowerCase().includes(query) ||
            (c.content || '').toLowerCase().includes(query) ||
            (c.category || '').toLowerCase().includes(query)
        );
    }

    const priorityRank = p => {
        const value = (p || '').toString().toLowerCase();
        if (value.includes('high') || value.includes('urgent')) return 0;
        if (value.includes('medium')) return 1;
        return 2;
    };

    if (sort === 'newest') {
        results.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    } else if (sort === 'oldest') {
        results.sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
    } else if (sort === 'priority_desc') {
        results.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
    } else if (sort === 'priority_asc') {
        results.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
    }

    renderComplaintTable(results);
}

function initializeTableControls() {
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const statusFilter = document.getElementById('statusFilter');
    const priorityFilter = document.getElementById('priorityFilter');
    const sentimentFilter = document.getElementById('sentimentFilter');
    const sortSelect = document.getElementById('sortSelect');

    [searchInput, categoryFilter, statusFilter, priorityFilter, sentimentFilter, sortSelect].forEach(element => {
        if (!element) return;
        element.addEventListener('input', applyTableFilters);
        element.addEventListener('change', applyTableFilters);
    });

    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', exportTableCsv);
    }
}

initializeTableControls();

(function() {
    const _fetch = window.fetch.bind(window);
    window.fetch = function(input, init = {}) {
        init = init || {};
        init.headers = init.headers || {};
        const token = (auth && auth.token) ? auth.token : localStorage.getItem('authToken');
        if (token && !init.headers['Authorization'] && !init.headers.Authorization) {
            init.headers['Authorization'] = 'Bearer ' + token;
        }
        return _fetch(input, init);
    };
})();

async function resolveComplaint(id) {
    try {
        const res = await fetch(`${dashboardApiUrl}/api/complaints/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Resolved' })
        });
        const payload = await res.json();
        if (!res.ok) {
            alert(payload.error || 'Failed to resolve complaint');
            return;
        }

        const idx = currentComplaints.findIndex(c => c.id === id);
        if (idx !== -1) {
            currentComplaints[idx].status = 'Resolved';
            renderComplaintTable(currentComplaints);
            renderNotifications(currentComplaints);
            updateStats(currentComplaints);
            showComplaintDetails(id);
        }
    } catch (err) {
        console.error('resolveComplaint error', err);
        alert('Error resolving complaint');
    }
}

async function discardComplaint(id) {
    try {
        const res = await fetch(`${dashboardApiUrl}/api/complaints/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Discarded' })
        });
        const payload = await res.json();
        if (!res.ok) {
            alert(payload.error || 'Failed to discard complaint');
            return;
        }

        const idx = currentComplaints.findIndex(c => c.id === id);
        if (idx !== -1) {
            currentComplaints[idx].status = 'Discarded';
            renderComplaintTable(currentComplaints);
            renderNotifications(currentComplaints);
            updateStats(currentComplaints);
            showComplaintDetails(id);
        }
    } catch (err) {
        console.error('discardComplaint error', err);
        alert('Error discarding complaint');
    }
}

function getFilteredComplaints() {
    const query = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
    const category = document.getElementById('categoryFilter')?.value || 'All Categories';
    const status = document.getElementById('statusFilter')?.value || 'All Statuses';
    const priority = document.getElementById('priorityFilter')?.value || 'All Priorities';
    const sentiment = document.getElementById('sentimentFilter')?.value || 'All Sentiments';
    const sort = document.getElementById('sortSelect')?.value || 'newest';

    let results = currentComplaints.slice();

    if (category !== 'All Categories') {
        results = results.filter(c => (c.category || '') === category);
    }
    if (status !== 'All Statuses') {
        results = results.filter(c => (c.status || '') === status);
    }
    if (priority !== 'All Priorities') {
        results = results.filter(c => (c.priority || '') === priority);
    }
    if (sentiment !== 'All Sentiments') {
        results = results.filter(c => (c.sentiment || '') === sentiment);
    }
    if (query) {
        results = results.filter(c =>
            (c.reference_code || '').toLowerCase().includes(query) ||
            (c.content || '').toLowerCase().includes(query) ||
            (c.category || '').toLowerCase().includes(query)
        );
    }

    const priorityRank = p => {
        const value = (p || '').toString().toLowerCase();
        if (value.includes('high') || value.includes('urgent')) return 0;
        if (value.includes('medium')) return 1;
        return 2;
    };

    if (sort === 'newest') {
        results.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    } else if (sort === 'oldest') {
        results.sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
    } else if (sort === 'priority_desc') {
        results.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
    } else if (sort === 'priority_asc') {
        results.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
    }

    return results;
}

function exportTableCsv() {
    const data = getFilteredComplaints();
    if (!data || data.length === 0) {
        alert('No complaints available to export.');
        return;
    }

    const headers = ['Reference', 'Category', 'Details', 'Status', 'Priority', 'Sentiment', 'Submitted'];
    const rows = data.map(c => [
        c.reference_code || '',
        c.category || '',
        c.content || '',
        c.status || '',
        c.priority || '',
        c.sentiment || '',
        new Date(c.submitted_at).toLocaleString()
    ]);

    const csv = [headers, ...rows]
        .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'complaints.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function renderComplaintActions(complaint, shouldShow) {
    const detailsPanel = document.getElementById('bigxDetails');
    if (!detailsPanel) return;

    const existingActions = detailsPanel.querySelector('.action-buttons');
    if (existingActions) {
        existingActions.remove();
    }

    if (!shouldShow || !complaint) return;

    const statusValue = (complaint.status || '').toLowerCase();
    if (statusValue === 'resolved' || statusValue === 'discarded') return;

    const actionContainer = document.createElement('div');
    actionContainer.className = 'action-buttons';
    actionContainer.style.display = 'flex';
    actionContainer.style.gap = '10px';
    actionContainer.style.flexWrap = 'wrap';
    actionContainer.style.marginTop = '12px';

    const resolveBtn = document.createElement('button');
    resolveBtn.textContent = 'Resolve Complaint';
    resolveBtn.className = 'resolve-btn';
    resolveBtn.type = 'button';
    resolveBtn.addEventListener('click', () => {
        if (!confirm('Mark this complaint as resolved?')) return;
        resolveComplaint(complaint.id);
    });

    const discardBtn = document.createElement('button');
    discardBtn.textContent = 'Discard Report';
    discardBtn.className = 'discard-btn';
    discardBtn.type = 'button';
    discardBtn.addEventListener('click', () => {
        if (!confirm('Mark this complaint as discarded? This will remove it from the notification queue.')) return;
        discardComplaint(complaint.id);
    });

    actionContainer.appendChild(resolveBtn);
    actionContainer.appendChild(discardBtn);
    detailsPanel.appendChild(actionContainer);
}

async function loadAdminManagement() {
    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const bigxDetails = document.getElementById('bigxDetails');
    if (!bigxDetails) return;

    if (!adminInfo.can_create_admins) {
        bigxDetails.innerHTML = '<div class="no-permission">?? You do not have permission to create admin accounts</div>';
        return;
    }

    bigxDetails.innerHTML = `
        <div class="create-admin-form">
            <h3>Create New Admin Account</h3>
            <div class="form-group">
                <label for="newAdminEmail">Email Address</label>
                <input type="email" id="newAdminEmail" placeholder="admin@futo.edu.ng" required>
            </div>
            <div class="form-group">
                <label for="newAdminName">Full Name</label>
                <input type="text" id="newAdminName" placeholder="Admin Name" required>
            </div>
            <div class="form-group">
                <label for="newAdminPassword">Password</label>
                <input type="password" id="newAdminPassword" placeholder="Enter password" required>
            </div>
            <div class="form-group">
                <button type="button" id="createAdminBtn">Create Admin</button>
            </div>
        </div>
        <div class="admin-list" id="adminsList" style="margin-top: 20px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f8fafc;">
            <h3 style="margin-bottom: 12px;">Existing Admins</h3>
            <p style="color: #64748b;">Admin list loading...</p>
        </div>
    `;

    const createAdminBtn = document.getElementById('createAdminBtn');
    if (createAdminBtn) {
        createAdminBtn.addEventListener('click', createNewAdmin);
    }
}

function showNLPLogs() {
    const bigxDetails = document.getElementById('bigxDetails');
    if (!bigxDetails) return;
    bigxDetails.innerHTML = `
        <div style="padding: 24px; color: #334155;">
            <h3 style="margin-bottom: 16px;">NLP Filter Logs</h3>
            <p>This section will display the NLP filter log history, including sentiment analysis, content classification, and quarantine decisions.</p>
            <div style="margin-top: 24px; padding: 20px; background: #f8fafc; border-radius: 16px; border: 1px solid #e5e7eb;">
                <p style="color: #64748b; margin: 0;">No NLP logs are available yet.</p>
            </div>
        </div>
    `;
}

function showPipelineSettings() {
    const bigxDetails = document.getElementById('bigxDetails');
    if (!bigxDetails) return;
    bigxDetails.innerHTML = `
        <div style="padding: 24px; color: #334155;">
            <h3 style="margin-bottom: 16px;">Pipeline Settings</h3>
            <p>Configure pipeline rules, filtering thresholds, and processing options from this panel.</p>
            <div style="margin-top: 24px; display: grid; gap: 16px;">
                <div style="padding: 20px; background: #f8fafc; border-radius: 16px; border: 1px solid #e5e7eb;">
                    <strong>Automated flagging</strong>
                    <p style="margin: 8px 0 0; color: #64748b;">Manage automated complaint classification and quarantine behavior.</p>
                </div>
                <div style="padding: 20px; background: #f8fafc; border-radius: 16px; border: 1px solid #e5e7eb;">
                    <strong>Review workflow</strong>
                    <p style="margin: 8px 0 0; color: #64748b;">Adjust review priorities and notification preferences.</p>
                </div>
            </div>
        </div>
    `;
}

async function createNewAdmin() {
    const emailInput = document.getElementById('newAdminEmail');
    const nameInput = document.getElementById('newAdminName');
    const passwordInput = document.getElementById('newAdminPassword');
    const btn = document.getElementById('createAdminBtn');

    if (!emailInput || !nameInput || !passwordInput || !btn) return;

    const email = emailInput.value.trim();
    const name = nameInput.value.trim();
    const password = passwordInput.value;

    if (!email || !name || !password) {
        alert('Please fill all fields');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        const response = await fetch(`${dashboardApiUrl}/api/auth/create-admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name, password })
        });

        const data = await response.json();
        if (!response.ok) {
            alert(data.error ? `Error: ${data.error}` : 'Failed to create admin');
            return;
        }

        alert('Admin created successfully!');
        emailInput.value = '';
        nameInput.value = '';
        passwordInput.value = '';
    } catch (error) {
        console.error('Error creating admin:', error);
        alert('Connection error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Create Admin';
        }
    }
}

document.getElementById('signOutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('adminInfo');
    window.location.href = 'admin.html';
});

async function loadComplaints() {
    const container = document.getElementById('complaintsContainer');
    if (!container) return;

    try {
        const response = await fetch(`${dashboardApiUrl}/api/complaints`);
        const data = await response.json();

        if (!response.ok) {
            container.innerHTML = '<p style="color: red;">Error loading complaints</p>';
            return;
        }

        if (!data.complaints || data.complaints.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #999;">No complaints yet</p>';
            updateStats([]);
            const bigxDetails = document.getElementById('bigxDetails');
            if (bigxDetails) {
                bigxDetails.innerHTML = '<div style="padding: 24px; color: #64748b;">Select a complaint to review detailed information.</div>';
            }
            return;
        }

        currentComplaints = data.complaints;
        renderNotifications(data.complaints);
        populateFilters(data.complaints);
        renderComplaintTable(data.complaints);
        updateStats(data.complaints);
        showComplaintDetails(data.complaints[0].id, { showActions: false });
    } catch (error) {
        console.error('Error loading complaints:', error);
        if (container) container.innerHTML = '<p style="color: red;">Connection error. Make sure the server is running.</p>';
    }
}

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        const index = e.currentTarget.dataset.index;

        document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', 'false'));
        e.currentTarget.setAttribute('aria-selected', 'true');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        const placeholder = document.getElementById('tabPlaceholder');
        const bigxDetails = document.getElementById('bigxDetails');

        if (index === '0') {
            document.getElementById('tab-0')?.classList.add('active');
            if (placeholder) placeholder.style.display = 'none';
            loadComplaints().then(() => {
                try {
                    const notifications = (currentComplaints || []).filter(c => {
                        const status = (c.status || '').toLowerCase();
                        return status !== 'resolved' && status !== 'discarded';
                    });
                    if (!notifications.length && bigxDetails) {
                        bigxDetails.innerHTML = '<div style="min-height:420px; display:flex; align-items:center; justify-content:center; color:#64748b; font-size:16px;">No notifications</div>';
                    }
                } catch (err) {
                    console.error('Error checking notifications after load:', err);
                }
            }).catch(err => {
                console.error('loadComplaints failed:', err);
            });
        } else {
            if (placeholder) placeholder.style.display = 'block';
            if (index === '1') loadAdminManagement();
            else if (index === '2') showNLPLogs();
            else if (index === '3') showPipelineSettings();
        }
    });
});

if (auth && auth.token) {
    setTimeout(() => { loadComplaints(); }, 100);
}
