// 1. Inicializace mapy
const map = L.map('map').setView([50.6607, 14.0328], 13); 

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

// 2. Lokální úložiště rozvaděčů
const rvoStore = {
    1: { id: 1, number: "1", name: "RVO 1 - Náměstí", lat: 50.6610, lng: 14.0330, commOk: false, mainPowerOk: false, circuits: { c1: false, c2: false }, contactorOn: false }
};

// 3. Připojení k WebSocket serveru (Backendu)
const socket = new WebSocket(`ws://${window.location.host}`);

socket.onmessage = function(event) {
    const response = JSON.parse(event.data);
    
    if (response.type === 'RVO_UPDATE') {
        const liveData = response.data;
        
        // Aktualizace dat rozvaděče v paměti
        if (rvoStore[liveData.id]) {
            Object.assign(rvoStore[liveData.id], liveData);
            updateRvoOnMap(rvoStore[liveData.id]);
        }
    }
};

socket.onclose = function() {
    console.warn("Ztráta spojení s backendovým serverem!");
    // Při výpadku webového serveru nastavíme bílý stav
    Object.values(rvoStore).forEach(rvo => {
        rvo.commOk = false;
        updateRvoOnMap(rvo);
    });
};

// 4. Výpočet stavu (barvy) rozvaděče
function getStatusColor(rvo) {
    if (!rvo.commOk) return 'white'; // Bílá = Ztráta komunikace
    if (!rvo.mainPowerOk) return 'red'; // Červená = Výpadek napěťového relé
    if (rvo.circuits && (!rvo.circuits.c1 || !rvo.circuits.c2)) return 'yellow'; // Žlutá = Upozornění na obvod
    return 'green'; // Zelená = Vše OK
}

// 5. Tvorba ikon na mapě podle zoomu
function getIcon(rvo) {
    const statusColor = getStatusColor(rvo);
    const zoom = map.getZoom();
    const size = Math.max(12, Math.min(60, 30 + (zoom - 13) * 6)); 
    const fontSize = Math.max(8, size * 0.45);

    return L.divIcon({
        className: `rvo-marker status-${statusColor}`,
        html: `<span style="font-size: ${fontSize}px">${rvo.number}</span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
    });
}

const dotGreen = '<span class="status-dot dot-green"></span>';
const dotRed = '<span class="status-dot dot-red"></span>';

// 6. Generování obsahu vyskakovacího okna
function generatePopup(rvo) {
    if (!rvo.commOk) {
        return `
            <div class="popup-content">
                <h3>${rvo.name}</h3>
                <p style="color: #6c757d; font-weight: bold;">Ztráta komunikace s PLC!</p>
            </div>`;
    }

    const powerStatus = rvo.mainPowerOk ? `${dotGreen} OK` : `${dotRed} VÝPADEK (Relé)`;
    const powerStyle = rvo.mainPowerOk ? 'border-color: #28a745;' : 'border-color: #dc3545; background-color: #f8d7da; color: #842029;';
    
    const c1Status = rvo.circuits.c1 ? `${dotGreen} OK` : `${dotRed} Porucha`;
    const c2Status = rvo.circuits.c2 ? `${dotGreen} OK` : `${dotRed} Porucha`;
    
    return `
        <div class="popup-content">
            <h3>${rvo.name}</h3>
            <div class="main-power" style="${powerStyle}">
                Hlavní napájení RVO: <br><b>${powerStatus}</b>
            </div>
            <div class="circuit">Snímaný obvod 1: <b>${c1Status}</b></div>
            <div class="circuit">Snímaný obvod 2: <b>${c2Status}</b></div>
            
            <button class="btn-contactor" onclick="toggleContactor(${rvo.id})">
                Stykač: <span>${rvo.contactorOn ? 'ZAPNUTO' : 'VYPNUTO'}</span>
            </button>
        </div>
    `;
}

// 7. Vykreslení nebo aktualizace rozvaděče na mapě
function updateRvoOnMap(rvo) {
    if (!rvo.markerElement) {
        const marker = L.marker([rvo.lat, rvo.lng], { icon: getIcon(rvo) }).addTo(map);
        marker.bindPopup(generatePopup(rvo));
        rvo.markerElement = marker;
    } else {
        rvo.markerElement.setIcon(getIcon(rvo));
        if (rvo.markerElement.isPopupOpen()) {
            rvo.markerElement.getPopup().setContent(generatePopup(rvo));
        }
    }
}

// Inicializace prvků na mapě
Object.values(rvoStore).forEach(rvo => updateRvoOnMap(rvo));

// Reakce na změnu ZOOMu
map.on('zoomend', function() {
    Object.values(rvoStore).forEach(rvo => {
        if (rvo.markerElement) rvo.markerElement.setIcon(getIcon(rvo));
    });
});

// 8. Odeslání povelu do PLC přes WebSocket
window.toggleContactor = function(id) {
    const rvo = rvoStore[id];
    if (rvo && rvo.commOk && rvo.mainPowerOk) {
        socket.send(JSON.stringify({
            command: 'TOGGLE_CONTACTOR',
            id: id
        }));
    } else if (rvo && !rvo.mainPowerOk) {
        alert("Nelze ovládat stykač. Výpadek hlavního napájení!");
    }
};