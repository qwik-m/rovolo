// 1. Inicializace mapy
const map = L.map('map').setView([50.6607, 14.0328], 13); 

// Tmavé mapové podklady CARTO s maxNativeZoom: 18
const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_4ca6_1_811760e8cf36cfcad66df8b0', {
    maxZoom: 20,
    maxNativeZoom: 18, // Správný limit pro CARTO rasterové dlaždice
    subdomains: 'abcd',
    attribution: '© OpenStreetMap, © CARTO'
});

// Světlé mapové podklady CARTO s maxNativeZoom: 18
const cartoVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_4ca6_1_811760e8cf36cfcad66df8b0', {
    maxZoom: 20,
    maxNativeZoom: 18, // Správný limit pro CARTO rasterové dlaždice
    subdomains: 'abcd',
    attribution: '© OpenStreetMap, © CARTO'
});

cartoDark.addTo(map);

L.control.layers({
    "Tmavá (Dark Matter)": cartoDark,
    "Světlá (Voyager)": cartoVoyager
}).addTo(map);

// Úložiště rozvaděčů na frontendu
const rvoStore = {};


// Funkce pro načtení a vykreslení/aktualizaci rozvaděčů
function loadCabinetsData(dataList) {
    dataList.forEach(item => {
        if (!rvoStore[item.id]) {
            rvoStore[item.id] = {
                id: item.id,
                number: item.number || String(item.id),
                name: item.name || `RVO ${item.id}`,
                lat: item.lat,
                lng: item.lng,
                address: item.address || '',
                description: item.description || '',
                commOk: item.commOk ?? false,
                mainPowerOk: item.mainPowerOk ?? false,
                circuits: item.circuits || { c1: false, c2: false },
                contactorOn: item.contactorOn ?? false
            };
        } else {
            Object.assign(rvoStore[item.id], item);
        }
        updateRvoOnMap(rvoStore[item.id]);
    });
}

// Načtení reálných dat z JSON konfigurace
fetch('rvo_config.json')
    .then(response => {
        if (!response.ok) throw new Error('Konfigurační soubor rvo_config.json nebyl nalezen.');
        return response.json();
    })
    .then(data => {
        loadCabinetsData(data);
    })
    .catch(err => {
        console.error('Chyba při načítání konfigurace RVO:', err.message);
    });

// KROK 2: Připojení k WebSocket serveru pro živá data z PLC
function connectWebSocket() {
    if (!window.location.host) return; // Pokud je stránka otevřena lokálně bez HTTP serveru

    const socket = new WebSocket(`ws://${window.location.host}`);

    socket.onopen = function() {
        console.log("WebSocket spojen s backendem.");
    };

    socket.onmessage = function(event) {
        try {
            const response = JSON.parse(event.data);
            if (response.type === 'RVO_INIT_ALL') {
                loadCabinetsData(response.data);
            }
        } catch (e) {
            console.error('Chyba zpracování WS zprávy:', e);
        }
    };

    socket.onclose = function() {
        console.warn("WebSocket odpojen.");
        Object.values(rvoStore).forEach(rvo => {
            rvo.commOk = false;
            updateRvoOnMap(rvo);
        });
    };

    window.rvoSocket = socket;
}

connectWebSocket();

function getStatusColor(rvo) {
    if (!rvo.commOk) return 'white';
    if (!rvo.mainPowerOk) return 'red';
    if (rvo.circuits && (!rvo.circuits.c1 || !rvo.circuits.c2)) return 'yellow';
    return 'green';
}

function getStatusText(statusColor) {
    switch(statusColor) {
        case 'green': return 'PROVOZ OK';
        case 'yellow': return 'VAROVÁNÍ';
        case 'red': return 'PORUCHA';
        case 'white': return 'OFFLINE';
        default: return 'NEZNÁMÝ';
    }
}

// 5. Tvorba ikon s PEVNÝM ukotvením středu (100% přesnost na GPS souřadnice)
function getIcon(rvo) {
    const statusColor = getStatusColor(rvo);
    const size = 32;
    const halfSize = 16; // Přesně polovina velikosti ikony

    return L.divIcon({
        className: 'rvo-marker-container',
        html: `<div class="rvo-badge status-${statusColor}">${rvo.number}</div>`,
        iconSize: [size, size],          // Velikost [32, 32]
        iconAnchor: [halfSize, halfSize], // Ukotvení GPS na střed [16, 16]
        popupAnchor: [0, -halfSize]       // Vyskakovací okno se otevře nad ikonou [0, -16]
    });
}

// POZNÁMKA: Událost map.on('zoomend', ...) již NENÍ POTŘEBA a byla odstraněna.
// Leaflet nyní drží pozice rozvaděčů 100% plynule a bez jakýchkoliv skoků.

function generatePopup(rvo) {
    const statusColor = getStatusColor(rvo);
    const statusText = getStatusText(statusColor);
    const addressText = rvo.address ? `<div class="popup-address"> ${rvo.address}</div>` : '';

    if (!rvo.commOk) {
        return `
            <div class="popup-card">
                <div class="popup-header">
                    <div class="popup-header-info">
                        <span class="popup-title" title="${rvo.name}">${rvo.name}</span>
                        ${addressText}
                    </div>
                    <span class="status-pill white">OFFLINE</span>
                </div>
                <div class="popup-body">
                    <p style="color: #94a3b8; font-size: 12px; margin: 5px 0;">${rvo.description || 'Bez komunikace s PLC.'}</p>
                </div>
            </div>`;
    }

    const powerDot = rvo.mainPowerOk ? '<span class="dot dot-green"></span>' : '<span class="dot dot-red"></span>';
    const c1Dot = rvo.circuits.c1 ? '<span class="dot dot-green"></span>' : '<span class="dot dot-red"></span>';
    const c2Dot = rvo.circuits.c2 ? '<span class="dot dot-green"></span>' : '<span class="dot dot-red"></span>';

    const btnClass = rvo.contactorOn ? 'active' : 'inactive';
    const btnText = rvo.contactorOn ? 'STYKAČ: ZAPNUTO' : 'STYKAČ: VYPNUTO';
    const isDisabled = !rvo.mainPowerOk ? 'disabled' : '';

    return `
        <div class="popup-card">
            <div class="popup-header">
                <div class="popup-header-info">
                    <span class="popup-title" title="${rvo.name}">${rvo.name}</span>
                    ${addressText}
                </div>
                <span class="status-pill ${statusColor}">${statusText}</span>
            </div>
            <div class="popup-body">
                <div class="info-row">
                    <span class="info-label">Napájení (Relé):</span>
                    <span class="info-value">${powerDot} ${rvo.mainPowerOk ? 'OK' : 'Výpadek'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Obvod 1:</span>
                    <span class="info-value">${c1Dot} ${rvo.circuits.c1 ? 'OK' : 'Porucha'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Obvod 2:</span>
                    <span class="info-value">${c2Dot} ${rvo.circuits.c2 ? 'OK' : 'Porucha'}</span>
                </div>
                
                <div class="contactor-control">
                    <button class="btn-toggle ${btnClass}" ${isDisabled} onclick="toggleContactor(${rvo.id})">
                        ${btnText}
                    </button>
                </div>
            </div>
        </div>
    `;
}

function updateRvoOnMap(rvo) {
    if (!rvo.markerElement) {
        const marker = L.marker([rvo.lat, rvo.lng], { icon: getIcon(rvo) }).addTo(map);
        marker.bindPopup(generatePopup(rvo));
        rvo.markerElement = marker;
    } else {
        rvo.markerElement.setLatLng([rvo.lat, rvo.lng]);
        rvo.markerElement.setIcon(getIcon(rvo));
        if (rvo.markerElement.isPopupOpen()) {
            rvo.markerElement.getPopup().setContent(generatePopup(rvo));
        }
    }
}


window.toggleContactor = function(id) {
    const rvo = rvoStore[id];
    if (rvo && rvo.commOk && rvo.mainPowerOk && window.rvoSocket) {
        window.rvoSocket.send(JSON.stringify({
            command: 'TOGGLE_CONTACTOR',
            id: id
        }));
    }
};