(function () {
    // content.js — simplified, robust implementation
    console.log('QT Tatkal content script loaded');

    function log(text) {
        console.log('[QT]', text);
        try { chrome.runtime.sendMessage({ action: 'log', text }); } catch (e) { }
    }

    // Wait for selector
    function waitForElement(selector, root = document, timeout = 5000) {
        return new Promise((resolve) => {
            const el = root.querySelector(selector);
            if (el) return resolve(el);
            const obs = new MutationObserver(() => {
                const found = root.querySelector(selector);
                if (found) { obs.disconnect(); resolve(found); }
            });
            obs.observe(root, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
        });
    }

    function setNativeValue(el, value) {
        try {
            const last = el.value;
            el.value = value;
            const e = new Event('input', { bubbles: true });
            el.dispatchEvent(e);
            el.dispatchEvent(new Event('change', { bubbles: true }));
            // try to notify React-like trackers
            try { if (el._valueTracker) el._valueTracker.setValue(last); } catch (e) { }
        } catch (e) { }
    }

    function humanDelay(min = 50, max = 160) {
        const t = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(r => setTimeout(r, t));
    }

    function isVisible(el) {
        if (!el) return false;
        try { if (el.offsetParent === null) return false; } catch (e) { }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function clickElement(el) {
        try { el.scrollIntoView({ block: 'center' }); } catch (e) { }
        try { el.focus(); } catch (e) { }
        try { el.click(); return true; } catch (e) { }
        try {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
        } catch (e) { return false; }
    }

    // station autocomplete
    async function fillStationAutocomplete(inputEl, stationText) {
        if (!inputEl || !stationText) return;
        const text = stationText.trim();
        setNativeValue(inputEl, text);
        inputEl.focus();
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));

        // wait for suggestions and click the first visible suggestion
        const selectors = ['li.ui-autocomplete-list-item', 'li[role="option"]', '.ui-autocomplete-list-item', '.ui-autocomplete-list li', '.ui-autocomplete li', '.ui-autocomplete div', '.ui-menu-item'];
        let suggestions = [];
        const maxWait = 3000; // ms
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            suggestions = selectors.flatMap(s => Array.from(document.querySelectorAll(s)));
            suggestions = suggestions.filter(Boolean);
            if (suggestions.length) break;
            await new Promise(r => setTimeout(r, 120));
        }

        const visibleSuggestions = suggestions.filter(s => isVisible(s));
        if (visibleSuggestions.length) {
            const first = visibleSuggestions[0];
            try { first.click(); await humanDelay(80, 140); return; } catch (e) { /* fallthrough to keyboard fallback */ }
        }

        // if no visible suggestion found, try matching by text then click first matching
        if (suggestions.length) {
            const normalize = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const target = text.toLowerCase();
            const matched = suggestions.find(si => normalize(si.innerText).includes(target));
            if (matched && isVisible(matched)) {
                try { matched.click(); await humanDelay(80, 140); return; } catch (e) { }
            }
            // otherwise click first suggestion regardless
            try { suggestions[0].click(); await humanDelay(80, 140); return; } catch (e) { }
        }

        // fallback: keyboard nav
        try { inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })); await humanDelay(60, 120); inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })); await humanDelay(60, 120); return; } catch (e) { }
        setNativeValue(inputEl, text); inputEl.blur();
    }

    async function fillPassengerForm(passengers = []) {
        if (!passengers || passengers.length === 0) return { status: 'no-data' };
        // naive: find the first name input and attempt to fill similar inputs
        const nameInputs = Array.from(document.querySelectorAll("input[placeholder*='Name'], input[formcontrolname*='name'], input[placeholder*='Passenger']"));
        for (let i = 0; i < passengers.length; i++) {
            const p = passengers[i];
            const input = nameInputs[i] || nameInputs[0];
            if (input && p.name) setNativeValue(input, p.name);
            // age
            const age = document.querySelector("input[formcontrolname*='passengerAge'], input[placeholder*='Age']");
            if (age && p.age) setNativeValue(age, p.age);
            // gender
            const gender = document.querySelector("select[formcontrolname*='passengerGender'], select[aria-label*='Gender']");
            if (gender && p.gender) { gender.value = p.gender; gender.dispatchEvent(new Event('change', { bubbles: true })); }
            await humanDelay(60, 140);
        }
        // mobile
        const mob = document.querySelector('#mobileNumber,input#mobileNumber,input[placeholder*="Mobile"]');
        if (mob && passengers[0] && passengers[0].mobile) setNativeValue(mob, passengers[0].mobile);
        return { status: 'done' };
    }

    // Open class tab, click availability, then Book Now
    async function searchAndBook(config) {
        try {
            // STEP 1: Click Search button
            let searchBtn = document.querySelector("button[title*='Search']") || document.querySelector("button[aria-label*='Search']");
            if (!searchBtn) searchBtn = Array.from(document.querySelectorAll('button')).find(b => /Search.*Train|Search/i.test((b.innerText || b.value || '').trim()) && isVisible(b));
            if (searchBtn) { clickElement(searchBtn); log('Clicked Search'); }
            else { log('Search button not found'); }

            // STEP 2: Wait for train results
            await waitForElement('.train-heading', document, 12000);
            let trainRow = null;
            if (config.trainNumber) {
                trainRow = Array.from(document.querySelectorAll('.train-heading')).find(h => (h.innerText || '').includes(config.trainNumber));
            }
            if (!trainRow) trainRow = document.querySelector('.train-heading');
            if (!trainRow) { log('No train row found'); return { status: 'no-train' }; }
            log('Found train: ' + (trainRow.innerText || '').slice(0, 50));

            // STEP 3: Get the full train container (card/section)
            const trainContainer = trainRow.closest('.form-group, app-train-avl-enq, div[class*="bull-back"], div[class*="border-all"]') || trainRow.closest('div') || trainRow.parentElement;

            // STEP 4: Find and click the class tab (pre-avl div) — e.g., "Sleeper (SL)", "AC 3 Tier (3A)", etc.
            const classHint = (config.travelClass || config.coach || '').toString().trim().toLowerCase();
            let classTab = null;
            let preAvlDivs = Array.from(trainContainer.querySelectorAll('div.pre-avl'));
            // If not found in container, search globally
            if (preAvlDivs.length === 0) {
                preAvlDivs = Array.from(document.querySelectorAll('div.pre-avl'));
            }

            if (classHint && preAvlDivs.length) {
                classTab = preAvlDivs.find(div => {
                    const txt = (div.innerText || '').toLowerCase();
                    if (txt.includes(classHint)) return true;
                    const code = classHint.replace(/[^a-z0-9]/g, '');
                    return code && (txt.includes(code) || txt.includes(code.replace(/([0-9])/, '$1 ')));
                });
            }
            // Fallback: click first pre-avl if no match
            if (!classTab && preAvlDivs.length) classTab = preAvlDivs[0];
            if (classTab) { clickElement(classTab); log('Clicked class tab: ' + (classTab.innerText || '').slice(0, 30)); await humanDelay(100, 200); }
            else { log('No class tab (pre-avl) found'); }

            // STEP 5: Wait for availability to load
            await waitForElement('div, span, table', trainContainer, 5000);

            // STEP 6: Find date/availability cells — look for visible cells with day numbers, "WL", or availability text
            const allCells = Array.from(trainContainer.querySelectorAll('div, span, td'));
            let avlCells = allCells.filter(c => {
                const txt = (c.innerText || '').trim();
                // Match cells with day numbers (1-31), "WL" prefix, or availability status
                return txt && (txt.match(/^WL\d+$/) || txt.match(/^\d{1,2}$/) || /available|avail/i.test(txt)) && isVisible(c) && c !== classTab;
            });

            let chosenCell = null;
            // If journey date provided, match the specific day
            if (config.journeyDate) {
                const m = (config.journeyDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
                const dayStr = m ? String(parseInt(m[3], 10)) : null;
                if (dayStr) chosenCell = avlCells.find(c => (c.innerText || '').trim() === dayStr || (c.innerText || '').split('\n').some(l => l.trim() === dayStr));
            }
            // Fallback: pick first available cell
            if (!chosenCell && avlCells.length) {
                chosenCell = avlCells.find(c => /WL\d+|available|avail/i.test((c.innerText || '').trim()));
                if (!chosenCell) chosenCell = avlCells[0];
            }

            if (chosenCell) { clickElement(chosenCell); log('Clicked availability: ' + (chosenCell.innerText || '').slice(0, 20)); await humanDelay(150, 300); }
            else { log('No availability cell found'); return { status: 'no-avl' }; }

            // STEP 7: Wait for and click Book Now button (class: train_Search, btnDefault, or contains text "Book Now")
            let bookBtn = null;
            for (let retry = 0; retry < 50; retry++) {
                bookBtn = Array.from(trainContainer.querySelectorAll('button')).find(b => {
                    const t = (b.innerText || b.value || '').trim();
                    return /Book Now/i.test(t) && isVisible(b);
                });
                if (bookBtn) break;
                // Also check global scope
                bookBtn = Array.from(document.querySelectorAll('button')).find(b => {
                    const t = (b.innerText || b.value || '').trim();
                    return /Book Now/i.test(t) && isVisible(b);
                });
                if (bookBtn) break;
                await humanDelay(200, 300);
            }
            if (bookBtn) { clickElement(bookBtn); log('Clicked Book Now'); return { status: 'book-clicked' }; }
            log('Book Now button not found');
            return { status: 'no-book-btn' };
        } catch (err) {
            log('searchAndBook error: ' + err);
            return { status: 'error', error: String(err) };
        }
    }

    // Automation controller
    let _running = false, _abort = false;
    function stopAutomation() { _abort = true; _running = false; log('Automation stopped'); }

    async function startAutomation(config) {
        if (_running) return { status: 'already' };
        _running = true; _abort = false;
        log('Automation start');
        try {
            // wait for login if needed
            const logged = !!document.querySelector("a[title='My Account'], .username, .logout");
            if (!logged) log('Ensure you are logged in manually');

            // fill from/to (keep references for later checks)
            let fromEl = null, toEl = null;
            if (config.from) {
                fromEl = await waitForElement("input[aria-label='Enter From station. Input is Mandatory.'], input[aria-label*='From station']", document, 3000) || document.querySelector('input[placeholder*="From"]');
                if (fromEl) await fillStationAutocomplete(fromEl, config.from);
            }
            if (config.to) {
                toEl = await waitForElement("input[aria-label='Enter To station. Input is Mandatory.'], input[aria-label*='To station']", document, 3000) || document.querySelector('input[placeholder*="To"]');
                if (toEl) await fillStationAutocomplete(toEl, config.to);
            }

            // date — select a date input that is explicitly for journey/date and avoid From/To inputs
            if (config.journeyDate) {
                let dateEl = document.querySelector(
                    "input[placeholder*='DD/MM/YYYY'], input[placeholder*='Journey Date'], input[aria-label*='Journey Date'], input[name*='journeyDate'], input[id*='journeyDate'], input[name*='travelDate'], input[id*='travelDate']"
                );
                if (!dateEl) {
                    dateEl = Array.from(document.querySelectorAll('input')).find(i => {
                        const ph = (i.getAttribute('placeholder') || '').toLowerCase();
                        const nm = (i.getAttribute('name') || '').toLowerCase();
                        const id = (i.id || '').toLowerCase();
                        const looksLikeDate = ph.includes('dd/mm') || ph.includes('journey') || ph.includes('date') || nm.includes('journey') || id.includes('journey');
                        return looksLikeDate && i !== fromEl && i !== toEl;
                    });
                }
                if (dateEl) {
                    let d = config.journeyDate;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, day] = d.split('-'); d = `${day}/${m}/${y}`; }
                    setNativeValue(dateEl, d);
                    dateEl.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            }

            // search and book
            const res = await searchAndBook(config);
            if (res && res.status === 'book-clicked') {
                // fill passengers
                if (config.passengers) await fillPassengerForm(config.passengers);
                // at this point captcha/payment is manual
                log('Reached passenger form / booking flow — manual steps (CAPTCHA/payment) likely required');
                // clear running flag
                try { chrome.storage.local.set({ automationRunning: false }); } catch (e) { }
                _running = false;
                return { status: 'done' };
            }
            _running = false;
            return res;
        } catch (err) {
            log('startAutomation error: ' + err);
            _running = false;
            try { chrome.storage.local.set({ automationRunning: false }); } catch (e) { }
            return { status: 'error', error: String(err) };
        }
    }

    // Message listener
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || !message.action) return;
        if (message.action === 'fill') {
            fillPassengerForm(message.passengers || []).then(r => sendResponse(r));
            return true;
        }
        if (message.action === 'start') {
            startAutomation(message.config || {}).then(r => sendResponse(r));
            return true;
        }
        if (message.action === 'stop') { stopAutomation(); sendResponse({ status: 'stopped' }); return true; }
    });

    // On load resume if flagged
    try {
        chrome.storage.local.get(['automationRunning', 'automationConfig'], res => {
            if (res && res.automationRunning) { log('Resuming stored automation'); setTimeout(() => startAutomation(res.automationConfig || {}), 100); }
        });
    } catch (e) { }

})();

// --- Debug dump interface (page-triggerable) ---
(function () {
    async function debugDump() {
        const out = { trains: [], globalBookBtns: [] };
        try {
            const trainHeads = Array.from(document.querySelectorAll('.train-heading, .train-name, .result-list .row, .trainRow, .train-info')).slice(0, 20);
            for (const head of trainHeads) {
                const container = head.closest('div') || head.parentElement || document;
                const headText = (head.innerText || '').trim().slice(0, 1000);
                const headHTML = (head.outerHTML || '').slice(0, 2000);
                const containerHTML = (container.outerHTML || '').slice(0, 4000);
                const classTabs = Array.from(container.querySelectorAll('button, a, li, div, span')).filter(el => /(sleeper|sl|3a|2a|chair|cc|first|book)/i.test(el.innerText || '')).map(el => ({ text: (el.innerText || '').trim(), outer: (el.outerHTML || '').slice(0, 1000) }));
                const availPanels = Array.from(container.querySelectorAll('.pre-avl, .availability, .avail, .availability-panel, .journey-dates')).map(el => ({ text: (el.innerText || '').trim().slice(0, 500), outer: (el.outerHTML || '').slice(0, 2000) }));
                const bookBtns = Array.from(container.querySelectorAll('button,a,input')).filter(el => /Book Now/i.test((el.innerText || el.value || '').trim())).map(el => ({ text: (el.innerText || el.value || '').trim(), outer: (el.outerHTML || '').slice(0, 1000) }));
                out.trains.push({ headText, headHTML, containerHTML, classTabs, availPanels, bookBtns });
            }
            out.globalBookBtns = Array.from(document.querySelectorAll('button,a,input')).filter(el => /Book Now/i.test((el.innerText || el.value || '').trim())).map(el => ({ text: (el.innerText || el.value || '').trim(), outer: (el.outerHTML || '').slice(0, 1000) }));
        } catch (err) { out.error = String(err); }
        return out;
    }

    // page -> content script trigger
    window.addEventListener('message', async (e) => {
        try {
            if (!e.data || e.data.type !== 'QT_DEBUG_DUMP') return;
            const result = await debugDump();
            window.postMessage({ type: 'QT_DEBUG_DUMP_RESULT', result }, '*');
        } catch (err) { window.postMessage({ type: 'QT_DEBUG_DUMP_RESULT', result: { error: String(err) } }, '*'); }
    });

    // also allow extension messages
    try {
        chrome.runtime.onMessage.addListener((msg, s, sendResponse) => {
            if (msg && msg.action === 'debugDump') { debugDump().then(r => sendResponse(r)); return true; }
        });
    } catch (e) { }

})();
