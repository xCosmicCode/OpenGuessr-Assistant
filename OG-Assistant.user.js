// ==UserScript==
// @name         OpenGuessr Assistant
// @namespace    https://github.com/xCosmicCode
// @version      3.2
// @description  Adds answer circle with radius control, as well as continent/country/region info to OpenGuessr
// @author       xCosmicCode
// @match        https://openguessr.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        defaultRadiusKm: 1500,
        autoCloseMs: 30000,
        buttonTopStart: 20,
        buttonSpacing: 36
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
        } catch (e) {}
        return null;
    }

    // Pick a random coordinate within a radius (km) around a point
    function randomizeCenterGeodesic(lat, lng, radiusKm) {
        const R = 6371.0088;
        const u = Math.random(), v = Math.random();
        const w = (radiusKm / R) * Math.sqrt(u);
        const t = 2 * Math.PI * v;
        const latRad = lat * Math.PI/180, lngRad = lng * Math.PI/180;
        const newLat = Math.asin(Math.sin(latRad) * Math.cos(w) + Math.cos(latRad) * Math.sin(w) * Math.cos(t));
        const newLng = lngRad + Math.atan2(Math.sin(t) * Math.sin(w) * Math.cos(latRad),
                                           Math.cos(w) - Math.sin(latRad) * Math.sin(newLat));
        let latDeg = newLat * 180/Math.PI, lngDeg = newLng * 180/Math.PI;
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
    const map = L.map('map', {worldCopyJump: true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxZoom: 19, attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    L.circle([${randLat}, ${randLng}], {
      color: 'red', fillColor: '#f03', fillOpacity: 0.25, radius: ${radiusMeters}
    }).addTo(map);
    const dLat = ${radiusKm} / 111.0;
    const latRad = Math.max(Math.min(${randLat}, 85) * Math.PI/180, -85*Math.PI/180);
    const dLon = ${radiusKm} / (111.320 * Math.max(Math.cos(latRad), 0.0001));
    const south = Math.max(${randLat} - dLat, -85), north = Math.min(${randLat} + dLat, 85);
    let west = ${randLng} - dLon, east = ${randLng} + dLon;
    if (west < -180) west += 360; if (east > 180) east -= 360;
    const bounds = L.latLngBounds([south, west], [north, east]);
    function fitMap() { try { map.invalidateSize(); map.fitBounds(bounds, {padding: [80, 80]}); }
                        catch(e) { map.setView([${randLat}, ${randLng}], 4); } }
    map.whenReady(fitMap); setTimeout(fitMap, 200);
    setTimeout(() => window.close(), ${CONFIG.autoCloseMs});
  <\/script>
</body>
</html>`;
        const win = window.open("", "_blank", "width=900,height=650");
        if (!win) return showPopup("Popup blocked. Allow popups for this site.");
        win.document.write(childHtml); win.document.close();
    }

    // Reverse geocode lat/lng to address details
    async function reverseGeocode(lat, lng) {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`;
        const res = await fetch(url, { headers: { 'User-Agent': 'OpenGuessr Script' } });
        return res.ok ? res.json() : Promise.reject('Geocoding failed');
    }

    // Show popup message on screen
    function showPopup(text) {
        const popup = document.createElement('div');
        popup.textContent = text;
        Object.assign(popup.style, {
            position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.9)', color: 'white', padding: '8px 14px',
            borderRadius: '6px', zIndex: 100000
        });
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 4000);
    }

    // Show continent using country code + restcountries API
    async function showContinent() {
        const coords = getCoords(); if (!coords) return showPopup('No coordinates found');
        try {
            const data = await reverseGeocode(...coords);
            const code = data.address?.country_code?.toUpperCase();
            if (!code) return showPopup('Unknown continent');
            const res = await fetch(`https://restcountries.com/v3.1/alpha/${code}`);
            const json = await res.json();
            const continent = json[0]?.region || 'Unknown continent';
            showPopup(`🌍 ${continent}`);
        } catch(e) { showPopup('❌ Failed to fetch continent'); }
    }

    // Show country name
    async function showCountry() {
        const coords = getCoords(); if (!coords) return showPopup('No coordinates found');
        try { const data = await reverseGeocode(...coords);
             const country = data.address?.country || 'Unknown country';
             showPopup(`🌍 ${country}`); }
        catch(e) { showPopup('❌ Failed to fetch country'); }
    }

    // Show country + region/state
    async function showCountryRegion() {
        const coords = getCoords(); if (!coords) return showPopup('No coordinates found');
        try { const data = await reverseGeocode(...coords);
             const addr = data.address || {};
             const region = addr.state || addr.region || addr.county || addr.municipality || 'Unknown region';
             const country = addr.country || 'Unknown country';
             showPopup(`🌍 ${country} – ${region}`); }
        catch(e) { showPopup('❌ Failed to fetch region'); }
    }

    // Create a styled floating button
    function createButton(text, topPx, onClick) {
        const button = document.createElement('button');
        button.textContent = text;
        Object.assign(button.style, {
            position: 'fixed', right: '20px', top: `${topPx}px`,
            background: '#007bff', color: '#fff', padding: '8px 15px',
            border: 'none', borderRadius: '8px', cursor: 'pointer', zIndex: 99999
        });
        button.onclick = onClick; document.body.appendChild(button); return button;
    }

    // Add all buttons and radius input
    function addButtons() {
        if (document.getElementById('circleRadiusInput')) return;
        let top = CONFIG.buttonTopStart;

        createButton('Show Answer Circle', top, () => {
            const coords = getCoords(); if (!coords) return showPopup('No coordinates found');
            const inputVal = parseFloat(radiusInput.value);
            const radiusKm = isNaN(inputVal) ? CONFIG.defaultRadiusKm : inputVal;
            openCircleMap(...coords, radiusKm);
        });

        top += CONFIG.buttonSpacing;
        const radiusInput = document.createElement('input');
        radiusInput.type = 'number'; radiusInput.id = 'circleRadiusInput'; radiusInput.min = '1';
        radiusInput.value = CONFIG.defaultRadiusKm;
        Object.assign(radiusInput.style, {
            position: 'fixed', right: '20px', top: `${top}px`,
            width: '110px', padding: '6px', borderRadius: '6px',
            zIndex: 99999, color:'black', textAlign:'right'
        });
        radiusInput.title = 'Radius (km)'; document.body.appendChild(radiusInput);

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
        } else { setTimeout(init, 500); }
    }

    init();
})();
