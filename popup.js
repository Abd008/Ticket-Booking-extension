/* popup.js
     - Simple UI to manage passenger details in chrome.storage.local
     - Allows adding passengers, saving, and triggering the background to fill
*/

function createPassengerRow(idx, data = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'passenger';
    wrapper.dataset.idx = idx;

    wrapper.innerHTML = `
        <strong>Passenger ${idx + 1}</strong>
        <label>Name<input name="name" placeholder="Name" value="${data.name || ''}"></label>
        <label>Age<input name="age" placeholder="Age" value="${data.age || ''}"></label>
        <label>Gender
            <select name="gender">
                <option value="">(select)</option>
                <option value="Male" ${data.gender === 'Male' ? 'selected' : ''}>Male</option>
                <option value="Female" ${data.gender === 'Female' ? 'selected' : ''}>Female</option>
                <option value="Other" ${data.gender === 'Other' ? 'selected' : ''}>Other</option>
            </select>
        </label>
        <label>Berth Preference<select name="berth">
            <option value="">(select)</option>
            <option value="Lower" ${data.berth === 'Lower' ? 'selected' : ''}>Lower</option>
            <option value="Middle" ${data.berth === 'Middle' ? 'selected' : ''}>Middle</option>
            <option value="Upper" ${data.berth === 'Upper' ? 'selected' : ''}>Upper</option>
            <option value="Side Lower" ${data.berth === 'Side Lower' ? 'selected' : ''}>Side Lower</option>
            <option value="Side Upper" ${data.berth === 'Side Upper' ? 'selected' : ''}>Side Upper</option>
        </select></label>
        <div><button class="remove">Remove</button></div>
    `;

    wrapper.querySelector('.remove').addEventListener('click', () => {
        wrapper.remove();
    });

    return wrapper;
}

function loadPassengersToUI(passengers = []) {
    const container = document.getElementById('passengers');
    container.innerHTML = '';
    passengers.forEach((p, i) => container.appendChild(createPassengerRow(i, p)));
}

function readPassengersFromUI() {
    const container = document.getElementById('passengers');
    const rows = Array.from(container.querySelectorAll('.passenger'));
    return rows.map(r => ({
        name: r.querySelector('input[name="name"]').value.trim(),
        age: r.querySelector('input[name="age"]').value.trim(),
        gender: r.querySelector('select[name="gender"]').value,
        berth: r.querySelector('select[name="berth"]').value
    })).filter(p => p.name !== '');
}

document.addEventListener('DOMContentLoaded', async () => {
    const addBtn = document.getElementById('addPassenger');
    const saveBtn = document.getElementById('save');
    const fillBtn = document.getElementById('fillNow');
    const status = document.getElementById('status');

    addBtn.addEventListener('click', () => {
        const container = document.getElementById('passengers');
        container.appendChild(createPassengerRow(container.children.length, {}));
    });

    saveBtn.addEventListener('click', async () => {
        const list = readPassengersFromUI();
        const cfg = {
            from: document.getElementById('fromInput').value.trim(),
            to: document.getElementById('toInput').value.trim(),
            journeyDate: document.getElementById('journeyDate').value || '',
            trainNumber: document.getElementById('trainNumber').value.trim(),
            payment: document.getElementById('paymentMode').value || ''
        };
        await chrome.storage.local.set({ passengers: list, config: cfg });
        status.textContent = 'Saved ' + list.length + ' passenger(s) and config.';
    });

    fillBtn.addEventListener('click', async () => {
        // Notify background to trigger fill on active tab
        chrome.runtime.sendMessage({ action: 'triggerFill' }, (resp) => {
            status.textContent = 'Fill triggered';
        });
    });

    // Load saved passengers into UI
    const data = await chrome.storage.local.get(['passengers', 'config']);
    const passengers = data.passengers || [];
    const savedCfg = data.config || {};
    // prefill config inputs
    if (savedCfg.from) document.getElementById('fromInput').value = savedCfg.from;
    if (savedCfg.to) document.getElementById('toInput').value = savedCfg.to;
    if (savedCfg.journeyDate) document.getElementById('journeyDate').value = savedCfg.journeyDate;
    if (savedCfg.trainNumber) document.getElementById('trainNumber').value = savedCfg.trainNumber;
    if (savedCfg.payment) document.getElementById('paymentMode').value = savedCfg.payment;
    if (passengers.length > 0) loadPassengersToUI(passengers);
    else document.getElementById('passengers').appendChild(createPassengerRow(0, {}));
    // Start/Stop automation and logs
    const startBtn = document.getElementById('startAuto');
    const stopBtn = document.getElementById('stopAuto');
    const logsDiv = document.getElementById('logs');
    const clearBtn = document.getElementById('clearLogs');

    startBtn.addEventListener('click', async () => {
        const list = readPassengersFromUI();
        const cfg = {
            from: document.getElementById('fromInput').value.trim(),
            to: document.getElementById('toInput').value.trim(),
            journeyDate: document.getElementById('journeyDate').value || '',
            trainNumber: document.getElementById('trainNumber').value.trim(),
            payment: document.getElementById('paymentMode').value || '',
            passengers: list
        };
        await chrome.storage.local.set({ passengers: list, config: cfg });
        // send start command to background which forwards to active tab
        chrome.runtime.sendMessage({ action: 'startAutomation', config: cfg }, (resp) => {
            status.textContent = 'Automation started';
        });
    });

    stopBtn.addEventListener('click', async () => {
        chrome.runtime.sendMessage({ action: 'stopAutomation' }, (resp) => {
            status.textContent = 'Automation stop requested';
        });
    });

    clearBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'clearLogs' }, (resp) => {
            logsDiv.innerHTML = '';
        });
    });

    // Poll logs every 1s
    async function refreshLogs() {
        chrome.runtime.sendMessage({ action: 'getLogs' }, (resp) => {
            if (!resp || !resp.logs) return;
            logsDiv.innerHTML = resp.logs.map(l => `<div>[${l.time}] ${l.text}</div>`).join('');
            logsDiv.scrollTop = logsDiv.scrollHeight;
        });
    }
    refreshLogs();
    const _poll = setInterval(refreshLogs, 1000);
});
document.getElementById("startAuto").onclick = async () => {
  const config = {
    from: fromInput.value.trim(),
    to: toInput.value.trim(),
    journeyDate: journeyDate.value,
    trainNumber: trainNumber.value.trim(),
    payment: paymentMode.value
  };

  const { passengers } = await chrome.storage.local.get(["passengers"]);

  chrome.runtime.sendMessage({
    action: "startAutomation",
    config: { ...config, passengers }
  });
};