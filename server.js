const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const nodes7 = require('nodes7');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(__dirname));

// Načtení konfiguračního souboru s rozvaděči
const configPath = path.join(__dirname, 'rvo_config.json');
let rvoConfig = [];

function loadRvoConfig() {
    try {
        const rawData = fs.readFileSync(configPath, 'utf8');
        rvoConfig = JSON.parse(rawData);
        console.log(`[CONFIG] Načteno ${rvoConfig.length} rozvaděčů ze souboru rvo_config.json`);
    } catch (err) {
        console.error('[CONFIG] Chyba při načítání rvo_config.json:', err.message);
        rvoConfig = [];
    }
}

loadRvoConfig();

// Objekt pro uchování živých stavů rozvaděčů
const rvoStates = {};

// Inicializace výchozích stavů pro rozvaděče z konfigurace
rvoConfig.forEach(item => {
    rvoStates[item.id] = {
        ...item, // Obsahuje: id, number, name, lat, lng, address, description, plcIp
        commOk: false,
        mainPowerOk: false,
        circuits: { c1: false, c2: false },
        contactorOn: false
    };
});

// Zde probíhá komunikace s PLC S7-1200 (např. pro RVO 1)
const plc = new nodes7();
const PLC_CONFIG = { port: 102, host: '192.168.0.1', rack: 0, slot: 1 };
const variables = { mainPowerOk: 'MR0', circuit1: 'MR1', circuit2: 'MR2', contactor: 'QX0.0' };

let plcConnected = false;

function connectPLC() {
    plc.initiateConnection(PLC_CONFIG, (err) => {
        if (err) {
            plcConnected = false;
            updateState(1, { commOk: false });
            setTimeout(connectPLC, 5000);
        } else {
            plcConnected = true;
            plc.setTranslationCB((tag) => variables[tag]);
            plc.addItems(Object.keys(variables));
            readPLCData();
        }
    });
}

function readPLCData() {
    if (!plcConnected) return;

    plc.readAllItems((err, values) => {
        if (!err && values) {
            updateState(1, {
                commOk: true,
                mainPowerOk: Boolean(values.mainPowerOk),
                circuits: { c1: Boolean(values.circuit1), c2: Boolean(values.circuit2) },
                contactorOn: Boolean(values.contactor)
            });
        } else {
            plcConnected = false;
            updateState(1, { commOk: false });
        }
        setTimeout(readPLCData, 500);
    });
}

function updateState(id, newState) {
    if (rvoStates[id]) {
        Object.assign(rvoStates[id], newState);
        broadcastStates();
    }
}

function broadcastStates() {
    const payload = JSON.stringify({
        type: 'RVO_INIT_ALL',
        data: Object.values(rvoStates)
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on('connection', (ws) => {
    // Po připojení pošleme kompletní seznam rozvaděčů a jejich stavů
    ws.send(JSON.stringify({
        type: 'RVO_INIT_ALL',
        data: Object.values(rvoStates)
    }));

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            if (parsed.command === 'TOGGLE_CONTACTOR' && plcConnected) {
                const targetId = parsed.id;
                const rvo = rvoStates[targetId];
                if (rvo && rvo.mainPowerOk) {
                    const newState = !rvo.contactorOn;
                    plc.writeItems('contactor', newState, (err) => {
                        if (!err) {
                            rvo.contactorOn = newState;
                            broadcastStates();
                        }
                    });
                }
            }
        } catch (e) {
            console.error('Chyba zpracování zprávy:', e);
        }
    });
});

connectPLC();

server.listen(3000, () => {
    console.log('Server běží na http://localhost:3000');
});