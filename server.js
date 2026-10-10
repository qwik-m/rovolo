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

// ==========================================
// 1. POMOCNÉ FUNKCE A LOGOVÁNÍ
// ==========================================

function logEvent(level, source, message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}`);
}

const PLC_VARIABLES = {
    mainPowerOk: 'I0.0',   // Čtení z fyzického vstupu %I0.0
    circuit1: 'I0.1',      // Čtení z fyzického vstupu %I0.1
    circuit2: 'I0.2',      // Čtení z fyzického vstupu %I0.2
    contactor: 'Q0.0',     // Čtení stavu fyzického výstupu %Q0.0
    webCommand: 'M10.0'    // ZÁPIS povelu z webu do merkeru %M10.0 (mimo MB0)
};

// Podklad pro uložení stavů a PLC instancí
const rvoStates = {};
const plcInstances = {};

// ==========================================
// 2. NAČTENÍ KONFIGURACE RVO_CONFIG.JSON
// ==========================================

const configPath = path.join(__dirname, 'rvo_config.json');

function loadRvoConfig() {
    try {
        const rawData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(rawData);
        logEvent('INFO', 'CONFIG', `Úspěšně načteno ${config.length} rozvaděčů ze souboru rvo_config.json`);
        return config;
    } catch (err) {
        logEvent('ERROR', 'CONFIG', `Chyba při načítání rvo_config.json: ${err.message}`);
        return [];
    }
}

const rvoConfigList = loadRvoConfig();

// Inicializace výchozích stavů
rvoConfigList.forEach(rvo => {
    rvoStates[rvo.id] = {
        ...rvo,
        commOk: false,
        mainPowerOk: false,
        circuits: { c1: false, c2: false },
        contactorOn: false,
        isPending: false // Zámek pro vyhlazení asynchronního zápisu z webu
    };
});

// ==========================================
// 3. SPRÁVA A KOMUNIKACE S PLC S7-1200
// ==========================================

function setupPlcConnections() {
    rvoConfigList.forEach(rvo => {
        if (!rvo.plcIp) {
            logEvent('WARNING', `RVO ${rvo.id}`, 'Není definována IP adresa PLC v rvo_config.json');
            return;
        }

        const plc = new nodes7();
        plcInstances[rvo.id] = {
            client: plc,
            connected: false,
            connecting: false
        };

        connectToPlc(rvo.id);
    });
}

function connectToPlc(rvoId) {
    const rvo = rvoStates[rvoId];
    const instance = plcInstances[rvoId];

    if (!rvo || !instance || instance.connecting) return;

    instance.connecting = true;
    const targetIp = rvo.plcIp;
    const targetPort = rvo.plcPort || 102;

    logEvent('INFO', `RVO ${rvo.id}`, `Navazuji spojení s PLC na IP ${targetIp}:${targetPort}...`);

    instance.client.initiateConnection({ port: targetPort, host: targetIp, rack: 0, slot: 1 }, (err) => {
        instance.connecting = false;

        if (err) {
            if (instance.connected) {
                logEvent('ALARM', `RVO ${rvo.id}`, `ZTRÁTA KOMUNIKACE S PLC (${targetIp})!`);
            }
            instance.connected = false;
            updateState(rvoId, { commOk: false });
            
            setTimeout(() => connectToPlc(rvoId), 5000);
        } else {
            logEvent('SUCCESS', `RVO ${rvo.id}`, `PLC na IP ${targetIp} úspěšně připojeno.`);
            instance.connected = true;

            instance.client.setTranslationCB((tag) => PLC_VARIABLES[tag]);
            instance.client.addItems(Object.keys(PLC_VARIABLES));
            
            readPlcCycle(rvoId);
        }
    });
}

function readPlcCycle(rvoId) {
    const instance = plcInstances[rvoId];
    const rvo = rvoStates[rvoId];

    if (!instance || !instance.connected) return;

    instance.client.readAllItems((err, values) => {
        if (err || !values) {
            logEvent('ERROR', `RVO ${rvoId}`, `Chyba čtení dat z PLC: ${err ? err.message : 'Prázdná data'}`);
            instance.connected = false;
            updateState(rvoId, { commOk: false });
            setTimeout(() => connectToPlc(rvoId), 5000);
            return;
        }

        const newPower = Boolean(values.mainPowerOk);
        const newC1 = Boolean(values.circuit1);
        const newC2 = Boolean(values.circuit2);
        const newContactor = Boolean(values.contactor);

        if (!rvo.commOk) {
            logEvent('INFO', `RVO ${rvoId}`, 'Komunikace s rozvaděčem obnovena.');
        }

        if (rvo.mainPowerOk !== newPower) {
            if (!newPower) {
                logEvent('ALARM', `RVO ${rvoId}`, 'PORUCHA: Výpadek hlavního napájení!');
            } else {
                logEvent('INFO', `RVO ${rvoId}`, 'OBNOVENO: Hlavní napájení je v pořádku.');
            }
        }

            // Vložit do readPlcCycle(rvoId) pod kontrolu mainPowerOk:

            // Detekce výpadku Větve 1
        if (rvo.circuits && rvo.circuits.c1 !== newC1) {
        if (!newC1 && rvo.contactorOn) {
            logEvent('ALARM', `RVO ${rvoId}`, 'PORUCHA: Výpadek napětí na Větvi 1!');
        } else if (newC1) {
            logEvent('INFO', `RVO ${rvoId}`, 'OBNOVENO: Větev 1 je v pořádku.');
    }
}

// Detekce výpadku Větve 2
if (rvo.circuits && rvo.circuits.c2 !== newC2) {
    if (!newC2 && rvo.contactorOn) {
        logEvent('ALARM', `RVO ${rvoId}`, 'PORUCHA: Výpadek napětí na Větvi 2!');
    } else if (newC2) {
        logEvent('INFO', `RVO ${rvoId}`, 'OBNOVENO: Větev 2 je v pořádku.');
    }
}

        // Příprava dat k aktualizaci
        const updatedFields = {
            commOk: true,
            mainPowerOk: newPower,
            circuits: { c1: newC1, c2: newC2 }
        };

        // Stav stykače přepíšeme z PLC pouze tehdy, pokud nečekáme na doběh povelu z webu
        if (!rvo.isPending) {
            updatedFields.contactorOn = newContactor;
        }

        updateState(rvoId, updatedFields);

        setTimeout(() => readPlcCycle(rvoId), 500);
    });
}

function updateState(id, newState) {
    if (rvoStates[id]) {
        Object.assign(rvoStates[id], newState);
        broadcastStates();
    }
}

// ==========================================
// 4. WEBSOCKET A POVELY Z WEBOVÉ APLIKACE
// ==========================================

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

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    logEvent('WEB', 'WEBSOCKET', `Připojen nový webový klient (${clientIp})`);

    ws.send(JSON.stringify({
        type: 'RVO_INIT_ALL',
        data: Object.values(rvoStates)
    }));

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);

            if (parsed.command === 'TOGGLE_CONTACTOR') {
                const targetId = parsed.id;
                const rvo = rvoStates[targetId];
                const instance = plcInstances[targetId];

                logEvent('COMMAND', 'WEB->PLC', `Přijat požadavek na spínání stykače pro RVO ID: ${targetId}`);

                if (!rvo || !instance) {
                    logEvent('ERROR', 'COMMAND', `Rozvaděč s ID ${targetId} neexistuje!`);
                    return;
                }

                if (!instance.connected) {
                    logEvent('ERROR', `RVO ${targetId}`, 'Povel odmítnut: PLC není připojeno!');
                    return;
                }

                if (!rvo.mainPowerOk) {
                    logEvent('WARNING', `RVO ${targetId}`, 'Povel odmítnut: Bezpečnostní blokování (Výpadek napájení)!');
                    return;
                }

                const newState = !rvo.contactorOn;
                
                // 1. Okamžitě změníme stav v paměti backendu a zamkneme dočasně přepisování z readPlcCycle
                rvo.contactorOn = newState;
                rvo.isPending = true;
                broadcastStates();

                logEvent('ACTION', `RVO ${targetId}`, `Zápis na PLC %M10.0 -> ${newState ? 'TRUE' : 'FALSE'}`);

                // 2. Zápis povelu do merkeru M10.0
                instance.client.writeItems('webCommand', newState, (err) => {
                    if (err) {
                        logEvent('ERROR', `RVO ${targetId}`, `Chyba při zápisu do PLC: ${err.message}`);
                        rvo.contactorOn = !newState;
                        rvo.isPending = false;
                        broadcastStates();
                    } else {
                        logEvent('SUCCESS', `RVO ${targetId}`, `Povel M10.0 úspěšně zapsán (${newState ? 'TRUE' : 'FALSE'})`);
                        
                        // Po 1.5 s uvolníme zámek pro běžný odpočet z PLC %Q0.0
                        setTimeout(() => {
                            rvo.isPending = false;
                        }, 1500);
                    }
                });
            }
        } catch (e) {
            logEvent('ERROR', 'WEBSOCKET', `Neplatná zpráva od klienta: ${e.message}`);
        }
    });

    ws.on('close', () => {
        logEvent('WEB', 'WEBSOCKET', `Webový klient (${clientIp}) odpojen.`);
    });
});

// ==========================================
// 5. SPUŠTĚNÍ SERVERU
// ==========================================

setupPlcConnections();

server.listen(3000, () => {
    logEvent('SYSTEM', 'SERVER', 'SCADA Backend server běží na http://localhost:3000');
});