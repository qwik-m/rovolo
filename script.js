// ==========================================
// 1. INICIALIZACE MAPY A PODKLADŮ
// ==========================================
const map = L.map('map').setView([50.5165181, 14.0475836], 13); 

// Světlé mapové podklady CARTO s maxNativeZoom: 18
const cartoVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_4ca6_1_811760e8cf36cfcad66df8b0', {
    maxZoom: 20,
    maxNativeZoom: 18,
    subdomains: 'abcd',
    attribution: '© OpenStreetMap, © CARTO'
});

// Tmavé mapové podklady CARTO s maxNativeZoom: 18
const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_4ca6_1_811760e8cf36cfcad66df8b0', {
    maxZoom: 20,
    maxNativeZoom: 18,
    subdomains: 'abcd',
    attribution: '© OpenStreetMap, © CARTO'
});


cartoVoyager.addTo(map);

L.control.layers({
    "Tmavá (Dark Matter)": cartoDark,
    "Světlá (Voyager)": cartoVoyager
}).addTo(map);

// Úložiště rozvaděčů na frontendu
const rvoStore = {};

// ==========================================
// 2. NAČTĚNÍ A STRUKTURA DAT
// ==========================================

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
                contactorOn: item.contactorOn ?? false,
                isPending: false // UI Zámek proti blikání
            };
        } else {
            // Zachování stavu zápisu (isPending) během aktualizace dat
            const currentPending = rvoStore[item.id].isPending;
            Object.assign(rvoStore[item.id], item);
            rvoStore[item.id].isPending = currentPending;
        }
        updateRvoOnMap(rvoStore[item.id]);
    });
}

// Načtení výchozí konfigurace z JSON
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

// ==========================================
// 3. WEBSOCKET KOMUNIKACE (HTTPS/WSS READY)
// ==========================================

function connectWebSocket() {
    if (!window.location.host) return;

    // Automatické přepínání mezi wss:// (HTTPS) a ws:// (HTTP)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.onopen = function() {
        console.log("WebSocket úspěšně spojen s backendem.");
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
        console.warn("WebSocket odpojen od backendu.");
        Object.values(rvoStore).forEach(rvo => {
            rvo.commOk = false;
            rvo.isPending = false;
            updateRvoOnMap(rvo);
        });
        setTimeout(connectWebSocket, 3000);
    };

    window.rvoSocket = socket;
}

connectWebSocket();

// ==========================================
// 4. LOGIKA STAVŮ A VYHODNOCENÍ PORUCH
// ==========================================

function getStatusColor(rvo) {
    if (!rvo.commOk) return 'white';
    // Porucha = Výpadek hlavního napájení NEBO výpadek kterékoliv z větví
    if (!rvo.mainPowerOk) return 'red';
    if (rvo.circuits && (!rvo.circuits.c1 || !rvo.circuits.c2)) return 'red';
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

// ==========================================
// 5. RENDER IKON A POPUP OKNA LEAFLET
// ==========================================

function getIcon(rvo) {
    const statusColor = getStatusColor(rvo);
    const size = 32;
    const halfSize = 16;

    return L.divIcon({
        className: 'rvo-marker-container',
        html: `<div class="rvo-badge status-${statusColor}">${rvo.number}</div>`,
        iconSize: [size, size],
        iconAnchor: [halfSize, halfSize],
        popupAnchor: [0, -halfSize]
    });
}

function generatePopup(rvo) {
    const statusColor = getStatusColor(rvo);
    const statusText = getStatusText(statusColor);
    const addressText = rvo.address ? `<div class="popup-address">${rvo.address}</div>` : '';

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

    let btnClass = rvo.contactorOn ? 'active' : 'inactive';
    let btnText = rvo.contactorOn ? 'STYKAČ: ZAPNUTO' : 'STYKAČ: VYPNUTO';
    let isDisabled = !rvo.mainPowerOk || rvo.isPending ? 'disabled' : '';

    if (rvo.isPending) {
        btnText = 'PROBÍHÁ ZÁPIS...';
        btnClass += ' pending';
    }

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
                    <button class="btn-toggle ${btnClass}" ${isDisabled} onclick="toggleContactor(event, ${rvo.id})">
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
        
        // Přepíše obsah popupu POUZE v případě, že se reálně změnilo HTML
        if (rvo.markerElement.isPopupOpen()) {
            const newContent = generatePopup(rvo);
            const popup = rvo.markerElement.getPopup();
            
            if (popup.getContent() !== newContent) {
                popup.setContent(newContent);
            }
        }
    }
}

// ==========================================
// 6. OVLÁDÁNÍ STYKAČE BEZ ZAVÍRÁNÍ A BLIKÁNÍ
// ==========================================

window.toggleContactor = function(event, id) {
    // Zamezí propadnutí události kliknutí do mapy (předchází zavření popup okna)
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const rvo = rvoStore[id];
    
    if (rvo && rvo.commOk && rvo.mainPowerOk && window.rvoSocket && !rvo.isPending) {
        rvo.isPending = true;
        updateRvoOnMap(rvo);

        window.rvoSocket.send(JSON.stringify({
            command: 'TOGGLE_CONTACTOR',
            id: id
        }));

        setTimeout(() => {
            if (rvo.isPending) {
                rvo.isPending = false;
                updateRvoOnMap(rvo);
            }
        }, 1500);
    }
};