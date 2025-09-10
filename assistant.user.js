// ==UserScript==
// @name         OpenGuessr Assistant
// @namespace    https://github.com/xCosmicCode
// @version      3.5
// @description  Adds answer circle with radius control, as well as continent/country/region info to OpenGuessr
// @author       xCosmicCode
// @match        https://openguessr.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// -----------------------------------------------------------------------------
// DISCLAIMER
// OpenGuessr Assistant is intended for personal learning and practice only.
// Do NOT use this script in multiplayer or competitive modes — doing so may
// violate OpenGuessr's Terms of Service. The author provides this script "as-is"
// without warranty. By installing or running this script, you accept full
// responsibility for any consequences, including account suspension, bans,
// or legal issues. The author assumes no liability for misuse.
// -----------------------------------------------------------------------------

(function() {
    'use strict';

    const CONFIG = {
        // Core behavior
        defaultRadiusKm: 1500,
        autoCloseMs: 60000,
        popupDurationMs: 5000,

        // UI layout
        buttonTopStart: 20,
        buttonSpacing: 36,
        radiusStepKm: 100,

        // Map window
        circleMapWidth: 900,
        circleMapHeight: 650,

        // Geographic constants
        earthRadiusKm: 6371.0088,
        kmPerDegreeLat: 111.0,
        kmPerDegreeLonEq: 111.32,
        minCosLat: 0.0001,
        maxSafeLatitude: 85,

        // Map rendering
        mapPadding: [80, 80]
    };

    // Get lat/lng from the Google Maps iframe
    function getCoords() {
        const iframe = document.querySelector('iframe[src*="google.com/maps/embed"], iframe[src*="maps.google.com"]');
        if (!iframe) return null;

        try {
            const url = new URL(iframe.src);
            const location = url.searchParams.get('location');
            if (location) return location.split(',').map(parseFloat);

            const coordsMatch = iframe.src.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (coordsMatch) return [parseFloat(coordsMatch[1]), parseFloat(coordsMatch[2])];
        } catch (e) {
            // Silent fail — return null below
        }

        return null;
    }

    // Pick a random coordinate within a radius (km) around a point
    function randomizeCenterGeodesic(lat, lng, radiusKm) {
        const R = CONFIG.earthRadiusKm;
        const u = Math.random();
        const v = Math.random();
        const w = (radiusKm / R) * Math.sqrt(u);
        const t = 2 * Math.PI * v;
        const latRad = lat * Math.PI / 180;
        const lngRad = lng * Math.PI / 180;

        const newLat = Math.asin(Math.sin(latRad) * Math.cos(w) + Math.cos(latRad) * Math.sin(w) * Math.cos(t));
        const newLng = lngRad + Math.atan2(
            Math.sin(t) * Math.sin(w) * Math.cos(latRad),
            Math.cos(w) - Math.sin(latRad) * Math.sin(newLat)
        );

        let latDeg = newLat * 180 / Math.PI;
        let lngDeg = newLng * 180 / Math.PI;

        lngDeg = ((lngDeg + 180) % 360 + 360) % 360 - 180;

        return [latDeg, lngDeg];
    }

    // Open a new map window with a red circle
    function openCircleMap(lat, lng, radiusKm) {
        const [randLat, randLng] = randomizeCenterGeodesic(lat, lng, radiusKm);
        const radiusMeters = radiusKm * 1000;

        const childHtml = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>OpenGuessr Answer Circle</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>html, body, #map { height: 100%; margin: 0; padding: 0; }</style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <script>
    const map = L.map('map', { worldCopyJump: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxZoom: 19, attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    L.circle([${randLat}, ${randLng}], {
      color: 'red', fillColor: '#f03', fillOpacity: 0.25, radius: ${radiusMeters}
    }).addTo(map);

    const dLat = ${radiusKm} / ${CONFIG.kmPerDegreeLat};
    const latRad = Math.max(
        Math.min(${randLat}, ${CONFIG.maxSafeLatitude}) * Math.PI / 180,
        -${CONFIG.maxSafeLatitude} * Math.PI / 180
    );
    const dLon = ${radiusKm} / (${CONFIG.kmPerDegreeLonEq} * Math.max(Math.cos(latRad), ${CONFIG.minCosLat}));

    const south = Math.max(${randLat} - dLat, -${CONFIG.maxSafeLatitude});
    const north = Math.min(${randLat} + dLat, ${CONFIG.maxSafeLatitude});
    let west = ${randLng} - dLon;
    let east = ${randLng} + dLon;

    if (west < -180) west += 360;
    if (east > 180) east -= 360;

    const bounds = L.latLngBounds([south, west], [north, east]);

    function fitMap() {
        try {
            map.invalidateSize();
            map.fitBounds(bounds, { padding: ${JSON.stringify(CONFIG.mapPadding)} });
        } catch(e) {
            map.setView([${randLat}, ${randLng}], 4);
        }
    }

    map.whenReady(fitMap);
    setTimeout(fitMap, 200);
    setTimeout(() => window.close(), ${CONFIG.autoCloseMs});
  <\/script>
</body>
</html>`;

        const win = window.open(
            "",
            "_blank",
            `width=${CONFIG.circleMapWidth},height=${CONFIG.circleMapHeight}`
        );
        if (!win) return showPopup("Popup blocked. Allow popups for this site.");
        win.document.write(childHtml);
        win.document.close();
    }

    // Reverse geocode lat/lng to address details
    async function reverseGeocode(lat, lng) {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`;
        const res = await fetch(url, { headers: { 'User-Agent': 'OpenGuessr Script' } });
        return res.ok ? res.json() : Promise.reject('Geocoding failed');
    }

    // Initialize currentPopup
    let currentPopup = null;

    // Show popup message on screen
    function showPopup(text) {
        if (currentPopup) {
            currentPopup.remove();
        }
        const popup = document.createElement('div');
        popup.textContent = text;
        Object.assign(popup.style, {
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.9)',
            color: 'white',
            padding: '8px 14px',
            borderRadius: '6px',
            zIndex: 100000,
            pointerEvents: 'none'
        });
        document.body.appendChild(popup);
        currentPopup = popup;
        setTimeout(() => {
            if (popup === currentPopup) currentPopup = null;
            popup.remove();
        }, CONFIG.popupDurationMs);
    }

    // Perform action using coordinates, with error handling
    async function withCoords(action) {
        const coords = getCoords();
        if (!coords) return showPopup('No coordinates found');

        try {
            await action(coords);
        } catch (e) {
            showPopup('❌ Operation failed');
        }
    }

    // Show continent using country code + restcountries API
    async function showContinent() {
        await withCoords(async (coords) => {
            const data = await reverseGeocode(...coords);
            const code = data.address?.country_code?.toUpperCase();
            if (!code) return showPopup('Unknown continent');

            const res = await fetch(`https://restcountries.com/v3.1/alpha/${code}`);
            const json = await res.json();
            const continent = json[0]?.region || 'Unknown continent';
            showPopup(`🌍 ${continent}`);
        });
    }

    // Show country name
    async function showCountry() {
        await withCoords(async (coords) => {
            const data = await reverseGeocode(...coords);
            const country = data.address?.country || 'Unknown country';
            showPopup(`🌍 ${country}`);
        });
    }

    // Show country + region/state
    async function showCountryRegion() {
        await withCoords(async (coords) => {
            const data = await reverseGeocode(...coords);
            const addr = data.address || {};
            const region = addr.state || addr.region || addr.county || addr.municipality || 'Unknown region';
            const country = addr.country || 'Unknown country';
            showPopup(`🌍 ${country} – ${region}`);
        });
    }

    // Create a styled floating button
    function createButton(text, topPx, onClick) {
        const button = document.createElement('button');
        button.textContent = text;
        Object.assign(button.style, {
            position: 'fixed',
            right: '20px',
            top: `${topPx}px`,
            background: '#007bff',
            color: '#fff',
            padding: '8px 15px',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            zIndex: 99999
        });
        button.onclick = onClick;
        document.body.appendChild(button);
        return button;
    }

    // Add all buttons and radius input
    function addButtons() {
        if (document.getElementById('circleRadiusInput')) return;

        let top = CONFIG.buttonTopStart;

        createButton('Show Answer Circle', top, () => {
            const coords = getCoords();
            if (!coords) return showPopup('No coordinates found');

            const inputVal = parseFloat(radiusInput.value);
            const radiusKm = isNaN(inputVal) ? CONFIG.defaultRadiusKm : inputVal;
            openCircleMap(...coords, radiusKm);
        });

        top += CONFIG.buttonSpacing;

        const radiusInput = Object.assign(document.createElement('input'), {
            type: 'number',
            id: 'circleRadiusInput',
            min: 0,
            step: CONFIG.radiusStepKm,
            value: Math.round(CONFIG.defaultRadiusKm / CONFIG.radiusStepKm) * CONFIG.radiusStepKm,
            title: 'Radius (km)'
        });

        Object.assign(radiusInput.style, {
            position: 'fixed',
            right: '20px',
            top: `${top}px`,
            zIndex: 99999,
            width: '110px',
            padding: '6px',
            borderRadius: '6px',
            border: '1px solid #ccc',
            color: 'black',
            background: 'white',
            textAlign: 'right',
            opacity: '0.7',
            cursor: 'text'
        });

        document.body.appendChild(radiusInput);

        top += CONFIG.buttonSpacing + 4;
        createButton('Show Continent', top, showContinent);
        top += CONFIG.buttonSpacing;
        createButton('Show Country', top, showCountry);
        top += CONFIG.buttonSpacing;
        createButton('Show Country + Region', top, showCountryRegion);
    }

    // Wait until iframe is loaded before initializing the UI
    function init() {
        if (document.querySelector('iframe[src*="google.com/maps/embed"], iframe[src*="maps.google.com"]')) {
            addButtons();
        } else {
            setTimeout(init, 500);
        }
    }

    init();

})();
