(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const els = {
    connection: $('#connection'),
    connectActions: $('#connect-actions'),
    connectedActions: $('#connected-actions'),
    accountEmail: $('#account-email'),
    disconnectBtn: $('#disconnect-btn'),
    runBtn: $('#run-btn'),
    companyName: $('#companyName'),
    folderUrl: $('#folderUrl'),
    recipientEmail: $('#recipientEmail'),
    dryRun: $('#dryRun'),
    status: $('#status'),
    results: $('#results')
  };

  let connected = false;
  let emailConfigured = false;

  async function refreshStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      connected = data.connected;
      emailConfigured = data.emailConfigured;
      renderConnection(data);
    } catch (_) {
      renderConnection({ connected: false });
    }
  }

  function renderConnection(data) {
    const dot = els.connection.querySelector('.dot');
    const label = els.connection.querySelector('.conn-label');
    if (data.connected) {
      dot.className = 'dot dot-on';
      label.textContent = data.email || 'Connected';
      els.connectActions.classList.add('hidden');
      els.connectedActions.classList.remove('hidden');
      els.accountEmail.textContent = data.email || 'your account';
      els.runBtn.disabled = false;
    } else {
      dot.className = 'dot dot-off';
      label.textContent = 'Not connected';
      els.connectActions.classList.remove('hidden');
      els.connectedActions.classList.add('hidden');
      els.runBtn.disabled = true;
    }
  }

  function showStatus(html, isError) {
    els.status.className = 'status' + (isError ? ' error' : '');
    els.status.innerHTML = html;
    els.status.classList.remove('hidden');
  }

  function clearStatus() {
    els.status.classList.add('hidden');
    els.status.innerHTML = '';
  }

  els.disconnectBtn.addEventListener('click', async () => {
    await fetch('/auth/disconnect', { method: 'POST' });
    els.results.classList.add('hidden');
    clearStatus();
    refreshStatus();
  });

  els.runBtn.addEventListener('click', async () => {
    if (!connected) return;
    const folderUrl = els.folderUrl.value.trim();
    if (!folderUrl) {
      showStatus('Please paste a Google Drive folder link or ID.', true);
      return;
    }

    const dryRun = els.dryRun.checked;
    els.runBtn.disabled = true;
    els.results.classList.add('hidden');
    showStatus(
      '<span class="spinner"></span>' +
        (dryRun
          ? 'Scanning and analyzing the folder…'
          : 'Scanning, organizing, and building the data room… this can take a minute.')
    );

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderUrl,
          companyName: els.companyName.value.trim(),
          recipientEmail: els.recipientEmail.value.trim(),
          dryRun
        })
      });
      const data = await res.json();
      if (!res.ok) {
        showStatus(data.error || 'Something went wrong.', true);
        els.runBtn.disabled = false;
        return;
      }

      let note = data.dryRun
        ? 'Preview complete — no folders were created.'
        : 'Data room built successfully.';
      if (data.emailed) note += ' Report emailed.';
      else if (els.recipientEmail.value.trim() && !emailConfigured) {
        note += ' (Email not sent — SMTP is not configured on the server.)';
      }
      showStatus(note, false);

      els.results.innerHTML = data.reportHtml;
      els.results.classList.remove('hidden');
      els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showStatus('Network error: ' + err.message, true);
    } finally {
      els.runBtn.disabled = false;
    }
  });

  // Surface OAuth redirect outcomes.
  const params = new URLSearchParams(location.search);
  if (params.get('auth') === 'success') {
    history.replaceState({}, '', location.pathname);
  } else if (params.get('auth')) {
    showStatus('Google connection was not completed. Please try again.', true);
    history.replaceState({}, '', location.pathname);
  }

  refreshStatus();
})();
