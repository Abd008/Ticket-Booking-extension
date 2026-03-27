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
        try {
            if (!passengers || passengers.length === 0) { log('No passengers provided'); return { status: 'no-data' }; }
            const p = passengers[0]; // fill first passenger
            log('Filling passenger: ' + (p.name || 'N/A'));

            // STEP 1: Fill passenger name from autocomplete
            let nameInput = document.querySelector('input[formcontrolname="passengerName"]');
            if (!nameInput) nameInput = document.querySelector('input[placeholder*="Name"]');
            log('Step 1: nameInput found = ' + (!!nameInput));
            if (nameInput && p.name) {
                // Clear field first
                nameInput.value = '';
                setNativeValue(nameInput, '');
                await humanDelay(100, 200);

                // Type name fresh — with longer delays per letter to give Angular time to respond
                log('Step 1a: typing ' + p.name + ' slowly');
                let earlyClickSuccess = false;

                for (let i = 0; i < p.name.length; i++) {
                    nameInput.value = p.name.substring(0, i + 1);
                    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                    nameInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: p.name[i] }));
                    nameInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: p.name[i] }));

                    // After 4th letter, check for and click dropdown immediately
                    if (i === 3) {
                        log('Step 1a: typed 4 letters, checking for dropdown...');
                        await humanDelay(1000, 1500);

                        // Check for dropdown and try to click it
                        const quickCheck = Array.from(document.querySelectorAll('li.ui-autocomplete-list-item')).filter(s => isVisible(s));
                        if (quickCheck.length > 0) {
                            log('Step 1a-early: Found dropdown with ' + quickCheck.length + ' item(s), clicking first...');
                            try {
                                quickCheck[0].click();
                                log('Step 1a-early: Successfully clicked suggestion!');
                                earlyClickSuccess = true;
                                await humanDelay(300, 500);
                                break; // Exit the typing loop
                            } catch (e) {
                                log('Step 1a-early: Click failed, continuing with full name typing: ' + e.message);
                            }
                        }
                    } else {
                        await humanDelay(150, 250); // slower typing: 150-250ms per letter
                    }
                }

                // If early click succeeded, skip the rest
                if (earlyClickSuccess) {
                    log('Step 1: Early click was successful, moving to Step 2');
                } else {
                    nameInput.focus();
                    log('Step 1b: finished full typing, watching for dropdown...');

                    // Give Angular final render time
                    await humanDelay(1000, 1500);

                    let suggestions = [];

                    const watchForDropdown = new Promise((resolve) => {
                        let attempts = 0;
                        const maxAttempts = 60; // 15 seconds more

                        const checkDropdown = setInterval(() => {
                            attempts++;

                            // Aggressively trigger events every iteration
                            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                            nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                            nameInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));

                            // Strategy 1: Look for rendered list items
                            const allLis = document.querySelectorAll('li.ui-autocomplete-list-item');
                            const visibleLis = Array.from(allLis).filter(s => isVisible(s));

                            // Strategy 2: Check if dropdown panel exists
                            const panel = document.querySelector('.ui-autocomplete-panel, [class*="autocomplete-panel"]');
                            const panelVisible = panel && isVisible(panel);

                            if (attempts % 5 === 0 || visibleLis.length > 0) {
                                log('Step 1c.' + attempts + ': found ' + visibleLis.length + ' items, panel visible=' + panelVisible);
                            }

                            if (visibleLis.length > 0) {
                                suggestions = visibleLis;
                                log('Step 1c: DROPDOWN DETECTED at attempt ' + attempts + ' with ' + suggestions.length + ' options');
                                clearInterval(checkDropdown);
                                resolve(true);
                            } else if (attempts >= maxAttempts) {
                                log('Step 1c: TIMEOUT - no dropdown found after ' + maxAttempts + ' attempts');
                                clearInterval(checkDropdown);
                                resolve(false);
                            }
                        }, 250);
                    });

                    await watchForDropdown;

                    if (suggestions.length > 0) {
                        const firstSuggestion = suggestions[0];
                        log('Option text: ' + (firstSuggestion.innerText || '').slice(0, 50));
                        try {
                            firstSuggestion.click();
                            log('Clicked first suggestion');
                            await humanDelay(300, 500);
                        } catch (e) {
                            log('Click failed: ' + e.message);
                        }
                    }
                    else {
                        log('Step 1: no suggestions detected, accepting field as-is');
                        // Just leave the typed name - it may be validated on form submit
                        await humanDelay(200, 400);
                    }
                }
            }

            // STEP 2: Fill contact number (try multiple selectors)
            let contactInput = document.querySelector('input[formcontrolname*="mobile"], input[formcontrolname*="phone"], input[placeholder*="Contact"], input[placeholder*="Mobile"]');
            if (!contactInput) {
                // Fallback: search all inputs for mobile/contact pattern
                contactInput = Array.from(document.querySelectorAll('input[type="text"]')).find(inp => {
                    const name = inp.getAttribute('name') || '';
                    const ph = inp.getAttribute('placeholder') || '';
                    const fc = inp.getAttribute('formcontrolname') || '';
                    return /mobile|phone|contact|telephone/i.test(name + ph + fc);
                });
            }

            log('Step 2: contactInput found = ' + (!!contactInput) + ', contact field visible = ' + (contactInput ? isVisible(contactInput) : 'N/A'));
            if (contactInput && p.mobile) {
                try {
                    setNativeValue(contactInput, p.mobile);
                    log('Step 2: Filled contact = ' + p.mobile);
                    await humanDelay(100, 150);
                } catch (e) {
                    log('Step 2: Contact fill error: ' + e.message);
                }
            } else if (!contactInput) {
                log('Step 2: Contact field not found on form');
            }

            // STEP 3: Handle insurance (if present) — decline/no insurance
            log('Step 3: checking insurance');
            const noInsuranceRadio = document.querySelector('input[type="radio"][formcontrolname*="insurance"][value*="no"], input[type="radio"][formcontrolname*="insurance"][value*="N"]');
            if (!noInsuranceRadio) {
                const insuranceLabels = Array.from(document.querySelectorAll('label')).filter(l => /no.*insurance|decline.*insurance/i.test(l.innerText));
                log('Step 3: insuranceLabels found = ' + insuranceLabels.length);
                if (insuranceLabels.length > 0) { clickElement(insuranceLabels[0]); log('Declined insurance'); await humanDelay(100, 150); }
            } else {
                clickElement(noInsuranceRadio); log('Declined insurance'); await humanDelay(100, 150);
            }

            // STEP 4: Select payment mode — BHIM/UPI (value="2")
            const bhimRadio = document.querySelector('input[type="radio"][name="paymentType"][value="2"]');
            log('Step 4: bhimRadio found = ' + (!!bhimRadio));
            if (bhimRadio) {
                clickElement(bhimRadio);
                log('Selected BHIM/UPI payment');
                await humanDelay(150, 250);
            } else {
                log('BHIM/UPI radio not found');
            }

            // STEP 5: Click Continue button
            let continueBtn = document.querySelector('button[type="submit"].search_btn, button[type="submit"]');
            log('Step 5: continueBtn found = ' + (!!continueBtn) + ', text = ' + (continueBtn?.innerText?.slice(0, 20) || 'null'));
            if (continueBtn && /Continue/i.test(continueBtn.innerText)) {
                clickElement(continueBtn);
                log('Clicked Continue button, waiting for CAPTCHA page...');
                await humanDelay(500, 1000);
                return { status: 'continue-clicked' };
            } else {
                log('Continue button not found or wrong text');
                return { status: 'no-continue' };
            }
        } catch (err) {
            log('fillPassengerForm error: ' + err);
            return { status: 'error', error: String(err) };
        }
    }

    // Handle CAPTCHA page — focus field and wait for user input
    async function handleCaptchaPage() {
        try {
            log('Step 6: Continue clicked, waiting for page transition...');
            await humanDelay(1500, 2500); // give page time to navigate

            // Check for error messages first
            const errorElement = document.querySelector('.error-message, .alert-danger, [class*="error"], [role="alert"]');
            if (errorElement && isVisible(errorElement)) {
                log('Step 6-error: Error message detected: ' + (errorElement.innerText || '').slice(0, 100));
                return { status: 'page-error', error: errorElement.innerText };
            }

            // Check current URL for context
            const currentUrl = window.location.href;
            log('Step 6-debug: Current URL = ' + currentUrl.slice(-50));

            // Check for various page indicators
            const hasPassengerForm = !!document.querySelector('input[formcontrolname="passengerName"]');
            const hasCaptchaForm = !!document.querySelector('input[formcontrolname="captcha"], img.captcha-img');
            const hasPaymentForm = !!document.querySelector('[class*="payment"], [class*="payment-mode"]');
            const hasReviewPage = !!document.querySelector('[class*="review"], [class*="summary"], [class*="confirmation"]');

            log('Step 6-debug: hasPassenger=' + hasPassengerForm + ', hasCaptcha=' + hasCaptchaForm + ', hasPayment=' + hasPaymentForm + ', hasReview=' + hasReviewPage);

            // If CAPTCHA form exists, find and focus the input
            if (hasCaptchaForm) {
                log('Step 6: CAPTCHA form detected, looking for input field...');

                // Find all possible CAPTCHA elements
                const captchaInputs = Array.from(
                    document.querySelectorAll('input[formcontrolname="captcha"], input#captcha, input[name="captcha"]')
                );

                const visibleInputs = captchaInputs.filter(inp => isVisible(inp));

                if (visibleInputs.length === 0) {
                    log('Step 6: Found CAPTCHA form but no visible input (' + captchaInputs.length + ' total)');
                    return { status: 'captcha-form-no-input' };
                }

                const captchaInput = visibleInputs[0];
                log('Step 6: CAPTCHA input ready (' + visibleInputs.length + ' visible of ' + captchaInputs.length + ')');

                // Aggressive focus to ensure cursor is visible and blinking
                captchaInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
                await humanDelay(400, 600);

                // Multiple focus methods to ensure cursor appears
                captchaInput.focus({ preventScroll: false });
                captchaInput.click();
                captchaInput.select(); // Select all (may make cursor more visible)
                captchaInput.dispatchEvent(new FocusEvent('focus', { bubbles: true, composed: true }));
                captchaInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
                captchaInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                captchaInput.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

                // Force cursor to start position
                captchaInput.setSelectionRange(0, 0);

                await humanDelay(200, 300);
                log('Step 6-ready: CAPTCHA field focused. Cursor blinking — type CAPTCHA and press Enter.');

                // Wait for user input
                return new Promise((resolve) => {
                    const onKeyDown = (e) => {
                        if (e.key === 'Enter' && captchaInput.value.length > 0) {
                            captchaInput.removeEventListener('keydown', onKeyDown);
                            log('Step 6: CAPTCHA submitted (' + captchaInput.value.length + ' chars)');
                            resolve({ status: 'captcha-submitted', value: captchaInput.value });
                        }
                    };
                    captchaInput.addEventListener('keydown', onKeyDown);

                    // 5 minute timeout
                    setTimeout(() => {
                        captchaInput.removeEventListener('keydown', onKeyDown);
                        log('Step 6: CAPTCHA input timeout (no Enter pressed)');
                        resolve({ status: 'captcha-timeout' });
                    }, 300000);
                });
            } else {
                log('Step 6-info: No CAPTCHA form found. Page may show review/confirmation instead.');
                return { status: 'no-captcha-form', pageInfo: { hasPayment: hasPaymentForm, hasReview: hasReviewPage } };
            }
        } catch (err) {
            log('Step 6-error: ' + err.message);
            return { status: 'error', error: String(err) };
        }
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
                log('Book Now clicked, waiting for psgninput page...');
                // wait for psgninput page to load
                const formEl = await waitForElement('input[formcontrolname="passengerName"], input[placeholder*="Name"]', document, 10000);
                if (!formEl) { log('Passenger form NOT loaded after 10s'); _running = false; return { status: 'form-timeout' }; }
                log('Passenger form loaded');

                // fill passengers and submit form
                if (config.passengers) {
                    log('Calling fillPassengerForm with ' + config.passengers.length + ' passengers');
                    const fillRes = await fillPassengerForm(config.passengers);
                    log('Passenger form status: ' + (fillRes?.status || 'unknown'));

                    // If passenger form was successfully filled and Continue was clicked, handle CAPTCHA
                    if (fillRes && fillRes.status === 'continue-clicked') {
                        log('Continue was clicked, now handling CAPTCHA page...');
                        const captchaRes = await handleCaptchaPage();
                        log('CAPTCHA handling result: ' + (captchaRes?.status || 'unknown'));

                        if (captchaRes && (captchaRes.status === 'captcha-entered' || captchaRes.status === 'captcha-timeout-with-value')) {
                            log('CAPTCHA was entered, waiting for payment/confirmation...');
                        }
                    }
                } else {
                    log('No passengers in config');
                }

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
