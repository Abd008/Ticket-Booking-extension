// background.js - service worker for commands and coordination

chrome.runtime.onInstalled.addListener(() => {
    console.log('QT Tatkal background installed');
});

// Trigger fill on the active IRCTC tab by reading stored passenger data
async function triggerFillOnActiveTab() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0) return;
        const tab = tabs[0];
        // only operate on IRCTC host
        if (!tab.url || !tab.url.startsWith('https://www.irctc.co.in')) {
            console.warn('Active tab is not IRCTC');
            return;
        }

        const data = await chrome.storage.local.get(['passengers']);
        const passengers = data.passengers || [];
        chrome.tabs.sendMessage(tab.id, { action: 'fill', passengers }, (resp) => {
            console.log('fill response', resp);
        });
    } catch (err) {
        console.error('triggerFillOnActiveTab error', err);
    }
}

// Keyboard command (defined in manifest) handler
chrome.commands.onCommand.addListener((command) => {
    if (command === 'fill-passengers') {
        triggerFillOnActiveTab();
    }
});

// Accept messages from popup (e.g., user clicked "Fill Now")
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // logs from content script
    if (message && message.action === 'log') {
        const text = message.text || '';
        const time = new Date().toISOString();
        chrome.storage.local.get({ logs: [] }, (res) => {
            const logs = res.logs || [];
            logs.push({ time, text });
            // keep last 500 entries
            if (logs.length > 500) logs.splice(0, logs.length - 500);
            chrome.storage.local.set({ logs });
        });
        sendResponse({ status: 'ok' });
        return true;
    }

    // popup requests logs
    if (message && message.action === 'getLogs') {
        chrome.storage.local.get({ logs: [] }, (res) => {
            sendResponse({ logs: res.logs || [] });
        });
        return true;
    }

    if (message && message.action === 'clearLogs') {
        chrome.storage.local.set({ logs: [] }, () => sendResponse({ status: 'cleared' }));
        return true;
    }

    if (message && message.action === 'triggerFill') {
        triggerFillOnActiveTab();
        sendResponse({ status: 'triggered' });
        return true;
    }

    // Start / stop automation requested from popup
    if (message && message.action === 'startAutomation') {
        // message.config should contain saved form + options
        // persist running state so content scripts on subsequent page loads can resume
        chrome.storage.local.set({ automationRunning: true, automationConfig: message.config }, async () => {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tabs || tabs.length === 0) return sendResponse({ status: 'no-tab' });
            const tab = tabs[0];
            chrome.tabs.sendMessage(tab.id, { action: 'start', config: message.config }, (resp) => {
                sendResponse({ status: 'started', resp });
            });
        });
        return true;
    }

    if (message && message.action === 'stopAutomation') {
        // clear running flag and forward stop to active tab
        chrome.storage.local.set({ automationRunning: false }, async () => {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tabs || tabs.length === 0) return sendResponse({ status: 'no-tab' });
            const tab = tabs[0];
            chrome.tabs.sendMessage(tab.id, { action: 'stop' }, (resp) => sendResponse({ status: 'stopped', resp }));
        });
        return true;
    }
});
