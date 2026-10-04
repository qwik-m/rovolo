const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const nodes7 = require('nodes7');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Servírování statických souborů (index.html, style.css, script.js)
app.use(express.static(__dirname));

// Konfigurace připojení k S7-1200
const plc = new nodes7();
const PLC_CONFIG = {
    port: 102,
    host: '192.168.0.222', // Doplň IP adresu tvého PLC
    rack: 0,
    slot: 1
};

// Mapování proměnných z PLC
const variables = {
    mainPowerOk: 'MR0',   // M0.0 - Hlídací relé napětí (%I0.0 převedeno nebo přímo MR0)
    circuit1: 'MR1',      // M0.1 - Obvod 1
    circuit2: 'MR2',      // M0.2 - Obvod 2
    contactor: 'QX0.0'    // %Q0.0 - Výstup pro stykač
};

let plcConnected = false;
let currentRvoState = {
    id: 1,
    commOk: false,
    mainPowerOk: false,
    circuits: { c1: false, c2: false },
    contactorOn: false
};

// Připojení k PLC
function connectPLC() {
    plc.initiateConnection(PLC_CONFIG, (err) => {
        if (err) {
            console.error('Chyba připojení k PLC:', err);
            plcConnected = false;
            broadcastState();
            setTimeout(connectPLC, 5000); // Opakovat pokus za 5s
        } else {
            console.log('PLC S7-1200 úspěšně připojeno!');
            plcConnected = true;
            plc.setTranslationCB((tag) => variables[tag]);
            plc.addItems(Object.keys(variables));
            readPLCData();
        }
    });
}

// Čtení dat z PLC v cyklu
function readPLCData() {
    if (!plcConnected) return;

    plc.readAllItems((err, values) => {
        if (err) {
            console.error('Chyba při čtení dat z PLC:', err);
            plcConnected = false;
        } else {
            // Aktualizace stavu
            currentRvoState.commOk = true;
            currentRvoState.mainPowerOk = Boolean(values.mainPowerOk);
            currentRvoState.circuits.c1 = Boolean(values.circuit1);
            currentRvoState.circuits.c2 = Boolean(values.circuit2);
            currentRvoState.contactorOn = Boolean(values.contactor);
        }
        
        broadcastState();
        setTimeout(readPLCData, 500); // Obnovovací frekvence 500ms
    });
}

// Odeslání aktualizovaných dat všem připojeným webovým klientům
function broadcastState() {
    const payload = JSON.stringify({
        type: 'RVO_UPDATE',
        data: {
            ...currentRvoState,
            commOk: plcConnected
        }
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// Příjem povelů z webové stránky (zapnutí/vypnutí stykače)
wss.on('connection', (ws) => {
    // Po připojení ihned pošleme aktuální stav
    ws.send(JSON.stringify({ type: 'RVO_UPDATE', data: currentRvoState }));

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            if (parsed.command === 'TOGGLE_CONTACTOR' && plcConnected) {
                const newState = !currentRvoState.contactorOn;
                
                // Zápis do DO výstupu PLC
                plc.writeItems('contactor', newState, (err) => {
                    if (err) console.error('Chyba při zápisu na PLC:', err);
                    else console.log(`Stykač přepnut do: ${newState}`);
                });
            }
        } catch (e) {
            console.error('Neplatný formát zprávy z frontendu:', e);
        }
    });
});

connectPLC();

server.listen(3000, () => {
    console.log('Webový server běží na http://localhost:3000');
});