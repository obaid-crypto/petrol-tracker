import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

function App() {
    const [activeScreen, setActiveScreen] = useState('dashboard');
    const [petrolEntries, setPetrolEntries] = useState([]);
    const [trips, setTrips] = useState([]);
    const [currentTrip, setCurrentTrip] = useState(null);
    const [totalKmSinceLastFill, setTotalKmSinceLastFill] = useState(0);

    const [litres, setLitres] = useState('');
    const [pricePerLitre, setPricePerLitre] = useState('');
    const [fillDate, setFillDate] = useState('');

    const [isTracking, setIsTracking] = useState(false);
    const [gpsMessage, setGpsMessage] = useState('');
    const [showGpsAlert, setShowGpsAlert] = useState(false);

    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showInstallPrompt, setShowInstallPrompt] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [canInstall, setCanInstall] = useState(false);

    // Manual entry states
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [manualKm, setManualKm] = useState('');

    const [gpsDebug, setGpsDebug] = useState({
        updates: 0,
        lastLat: 0,
        lastLng: 0,
        accuracy: 0,
        speed: 0,
        status: 'Not started',
        lastDistance: 0
    });

    const watchIdRef = useRef(null);
    const lastPositionRef = useRef(null);
    const isInitialMount = useRef(true);
    const positionCountRef = useRef(0);
    const positionHistoryRef = useRef([]);
    const isFirstPositionAfterStart = useRef(true);

    const toRad = useCallback((degrees) => {
        return degrees * (Math.PI / 180);
    }, []);

    const calculateDistance = useCallback((lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }, [toRad]);

    const showGpsMessage = useCallback((message, isError = false) => {
        setGpsMessage(message);
        setShowGpsAlert(true);

        if (!isError) {
            setTimeout(() => {
                setShowGpsAlert(false);
            }, 3000);
        }
    }, []);

    const handleGPSError = useCallback((error) => {
        console.error('GPS Error:', error);

        let message = '';
        let status = 'Error';

        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = 'Please allow GPS permission';
                status = 'Permission Denied';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'GPS unavailable. Go outdoors!';
                status = 'Signal Unavailable';
                break;
            case error.TIMEOUT:
                message = 'GPS timeout. Retrying...';
                status = 'Searching for signal...';
                setGpsDebug(prev => ({ ...prev, status }));
                return;
            default:
                message = 'GPS error: ' + error.message;
                status = 'Error';
        }

        setGpsDebug(prev => ({ ...prev, status }));
        showGpsMessage(message, true);
    }, [showGpsMessage]);

    const handlePositionUpdate = useCallback((position) => {
        positionCountRef.current += 1;
        const updateNum = positionCountRef.current;

        console.log(`\n========== GPS Update #${updateNum} ==========`);
        console.log('Time:', new Date().toLocaleTimeString());
        console.log('Lat:', position.coords.latitude.toFixed(8));
        console.log('Lng:', position.coords.longitude.toFixed(8));
        console.log('Accuracy:', position.coords.accuracy.toFixed(1), 'm');
        console.log('Speed:', position.coords.speed, 'm/s');

        const newPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || 0,
            timestamp: Date.now()
        };

        positionHistoryRef.current.push(newPosition);
        if (positionHistoryRef.current.length > 5) {
            positionHistoryRef.current.shift();
        }

        setGpsDebug({
            updates: updateNum,
            lastLat: position.coords.latitude,
            lastLng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || 0,
            status: 'Active ✓',
            lastDistance: 0
        });

        if (isFirstPositionAfterStart.current) {
            console.log('ℹ️ First position after start - reference point');
            lastPositionRef.current = newPosition;
            positionHistoryRef.current = [newPosition];
            isFirstPositionAfterStart.current = false;
            console.log('==========================================\n');
            return;
        }

        if (lastPositionRef.current) {
            const distance = calculateDistance(
                lastPositionRef.current.lat,
                lastPositionRef.current.lng,
                newPosition.lat,
                newPosition.lng
            );

            const distanceMeters = distance * 1000;
            console.log('Distance from last:', distanceMeters.toFixed(2), 'm');

            let shouldUpdate = false;
            let reason = '';

            if (distanceMeters < 10) {
                reason = 'Distance < 10m (GPS drift)';
                console.log('⏭️', reason);
            }
            else if (position.coords.accuracy > 30) {
                reason = 'Accuracy poor (' + position.coords.accuracy.toFixed(0) + 'm)';
                console.log('⏭️', reason);
            }
            else if (position.coords.speed !== null && position.coords.speed < 0.5) {
                if (distanceMeters < 15) {
                    reason = 'Low speed and small distance';
                    console.log('⏭️', reason);
                } else {
                    shouldUpdate = true;
                    reason = 'Distance significant despite low speed';
                }
            }
            else if (positionHistoryRef.current.length >= 3) {
                let totalDistance = 0;
                for (let i = 1; i < positionHistoryRef.current.length; i++) {
                    const prev = positionHistoryRef.current[i - 1];
                    const curr = positionHistoryRef.current[i];
                    totalDistance += calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng) * 1000;
                }

                console.log('Total over', positionHistoryRef.current.length, 'points:', totalDistance.toFixed(2), 'm');

                if (totalDistance > 20) {
                    shouldUpdate = true;
                    reason = 'Consistent movement';
                } else if (distanceMeters > 20) {
                    shouldUpdate = true;
                    reason = 'Large single movement';
                } else {
                    reason = 'Total movement too small (drift)';
                    console.log('⏭️', reason);
                }
            }
            else if (distanceMeters > 20) {
                shouldUpdate = true;
                reason = 'Large movement detected';
            }

            if (shouldUpdate) {
                console.log('✅ UPDATING -', reason);
                console.log('Adding:', distanceMeters.toFixed(2), 'm');

                setCurrentTrip(prev => {
                    if (!prev) return prev;
                    const newDistance = prev.distance + distance;
                    console.log('Trip:', prev.distance.toFixed(6), '→', newDistance.toFixed(6), 'km');
                    return { ...prev, distance: newDistance };
                });

                setTotalKmSinceLastFill(prev => {
                    const newTotal = prev + distance;
                    console.log('Total:', prev.toFixed(6), '→', newTotal.toFixed(6), 'km');
                    return newTotal;
                });

                setGpsDebug(prev => ({ ...prev, lastDistance: distanceMeters }));
                lastPositionRef.current = newPosition;
                positionHistoryRef.current = [newPosition];
            } else {
                console.log('⏭️ Skipped -', reason);
                setGpsDebug(prev => ({ ...prev, lastDistance: 0 }));
            }
        } else {
            console.log('ℹ️ Setting initial reference point');
            lastPositionRef.current = newPosition;
            positionHistoryRef.current = [newPosition];
        }

        console.log('==========================================\n');
    }, [calculateDistance]);

    useEffect(() => {
        const loadData = () => {
            try {
                const stored = localStorage.getItem('petrolTrackerData');
                if (stored) {
                    const data = JSON.parse(stored);
                    setPetrolEntries(data.petrolEntries || []);
                    setTrips(data.trips || []);
                    setCurrentTrip(data.currentTrip || null);
                    setTotalKmSinceLastFill(data.totalKmSinceLastFill || 0);
                }
            } catch (error) {
                console.error('Error loading data:', error);
            }
        };

        const setTodayDate = () => {
            const today = new Date().toISOString().split('T')[0];
            setFillDate(today);
        };

        loadData();
        setTodayDate();
    }, []);

    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        const data = {
            petrolEntries,
            trips,
            currentTrip,
            totalKmSinceLastFill,
            lastSaved: new Date().toISOString()
        };

        localStorage.setItem('petrolTrackerData', JSON.stringify(data));
    }, [petrolEntries, trips, currentTrip, totalKmSinceLastFill]);

    useEffect(() => {
        const handler = (e) => {
            e.preventDefault();
            console.log('Install prompt available');
            setDeferredPrompt(e);
            setCanInstall(true);
            setShowInstallPrompt(true);
        };

        window.addEventListener('beforeinstallprompt', handler);

        if (window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true) {
            console.log('App is already installed');
            setShowInstallPrompt(false);
            setCanInstall(false);
        }

        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const handleResetRequest = () => {
        setShowResetConfirm(true);
    };

    const confirmReset = () => {
        if (watchIdRef.current) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }

        setPetrolEntries([]);
        setTrips([]);
        setCurrentTrip(null);
        setTotalKmSinceLastFill(0);
        setLitres('');
        setPricePerLitre('');
        const today = new Date().toISOString().split('T')[0];
        setFillDate(today);
        setIsTracking(false);
        lastPositionRef.current = null;
        positionCountRef.current = 0;
        positionHistoryRef.current = [];
        isFirstPositionAfterStart.current = true;

        setGpsDebug({
            updates: 0,
            lastLat: 0,
            lastLng: 0,
            accuracy: 0,
            speed: 0,
            status: 'Not started',
            lastDistance: 0
        });

        localStorage.removeItem('petrolTrackerData');

        setShowResetConfirm(false);
        setActiveScreen('dashboard');

        alert('✅ All data reset!');
    };

    const cancelReset = () => {
        setShowResetConfirm(false);
    };

    const handleInstallClick = async () => {
        if (!deferredPrompt) {
            if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
                alert('To install:\n\n1. Tap Share button (⬆️)\n2. Tap "Add to Home Screen"\n3. Tap "Add"');
                return;
            }
            alert('Install option not available. Try opening in Chrome or Safari.');
            return;
        }

        const promptEvent = deferredPrompt;
        promptEvent.prompt();

        const { outcome } = await promptEvent.userChoice;
        console.log('Install outcome:', outcome);

        if (outcome === 'accepted') {
            setShowInstallPrompt(false);
            setCanInstall(false);
        }

        setDeferredPrompt(null);
    };

    const savePetrolEntry = () => {
        const litresNum = parseFloat(litres);
        const priceNum = parseFloat(pricePerLitre);

        if (!litresNum || litresNum <= 0) {
            alert('❌ Please enter valid litres!');
            return;
        }

        if (!priceNum || priceNum <= 0) {
            alert('❌ Please enter valid price!');
            return;
        }

        if (!fillDate) {
            alert('❌ Please select a date!');
            return;
        }

        const entry = {
            id: Date.now(),
            litres: litresNum,
            pricePerLitre: priceNum,
            totalCost: litresNum * priceNum,
            date: fillDate,
            kmTraveled: totalKmSinceLastFill,
            mileage: totalKmSinceLastFill > 0 ? (totalKmSinceLastFill / litresNum).toFixed(2) : 0
        };

        setPetrolEntries(prev => [entry, ...prev]);
        setTotalKmSinceLastFill(0);
        setTrips([]);
        setLitres('');
        setPricePerLitre('');
        const today = new Date().toISOString().split('T')[0];
        setFillDate(today);

        alert('✅ Petrol entry saved!');
        setActiveScreen('dashboard');
    };

    // NEW: Manual KM Entry Functions
    const handleManualEntryRequest = () => {
        setShowManualEntry(true);
    };

    const saveManualKm = () => {
        const kmNum = parseFloat(manualKm);

        if (!kmNum || kmNum <= 0) {
            alert('❌ Please enter valid kilometers!');
            return;
        }

        if (kmNum > 1000) {
            const confirm = window.confirm('⚠️ You entered ' + kmNum + ' km.\n\nThis seems very high. Continue?');
            if (!confirm) return;
        }

        console.log('Adding manual KM:', kmNum);

        setTotalKmSinceLastFill(prev => {
            const newTotal = prev + kmNum;
            console.log('Manual KM added:', prev.toFixed(2), '→', newTotal.toFixed(2), 'km');
            return newTotal;
        });

        // Add to trips history
        const manualTrip = {
            id: Date.now(),
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            distance: kmNum,
            isActive: false,
            isManual: true
        };

        setTrips(prev => [...prev, manualTrip]);

        setManualKm('');
        setShowManualEntry(false);

        alert('✅ ' + kmNum + ' km added to total!');
    };

    const cancelManualEntry = () => {
        setManualKm('');
        setShowManualEntry(false);
    };

    const startTrip = () => {
        console.log('\n🚀 ========== STARTING GPS ==========');

        if (!navigator.geolocation) {
            alert('❌ GPS not supported');
            return;
        }

        positionCountRef.current = 0;
        lastPositionRef.current = null;
        positionHistoryRef.current = [];
        isFirstPositionAfterStart.current = true;

        setGpsDebug(prev => ({ ...prev, status: 'Getting GPS lock...' }));

        const newTrip = {
            id: Date.now(),
            startTime: new Date().toISOString(),
            distance: 0,
            isActive: true
        };

        setCurrentTrip(newTrip);
        setIsTracking(true);

        console.log('Requesting initial GPS position...');

        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('✅ GPS locked!');
                console.log('Initial position:', position.coords);

                lastPositionRef.current = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    speed: position.coords.speed || 0,
                    timestamp: Date.now()
                };

                positionHistoryRef.current = [lastPositionRef.current];

                setGpsDebug(prev => ({ ...prev, status: 'Tracking active' }));

                console.log('Starting GPS watch...');
                console.log('💡 First position = reference (0 km)');

                watchIdRef.current = navigator.geolocation.watchPosition(
                    handlePositionUpdate,
                    handleGPSError,
                    {
                        enableHighAccuracy: true,
                        timeout: 30000,
                        maximumAge: 5000
                    }
                );

                console.log('✅ Tracking started!');
                showGpsMessage('🟢 GPS Active!', false);
            },
            (error) => {
                console.error('❌ GPS error:', error);

                if (error.code === 3) {
                    console.log('Retrying with standard GPS...');
                    setGpsDebug(prev => ({ ...prev, status: 'Retrying...' }));

                    navigator.geolocation.getCurrentPosition(
                        (position) => {
                            console.log('✅ Position obtained (standard mode)');

                            lastPositionRef.current = {
                                lat: position.coords.latitude,
                                lng: position.coords.longitude,
                                accuracy: position.coords.accuracy,
                                speed: position.coords.speed || 0,
                                timestamp: Date.now()
                            };

                            positionHistoryRef.current = [lastPositionRef.current];

                            watchIdRef.current = navigator.geolocation.watchPosition(
                                handlePositionUpdate,
                                handleGPSError,
                                {
                                    enableHighAccuracy: false,
                                    timeout: 30000,
                                    maximumAge: 10000
                                }
                            );

                            showGpsMessage('🟡 GPS Active (Standard)', false);
                            setGpsDebug(prev => ({ ...prev, status: 'Active (Standard GPS)' }));
                        },
                        (retryError) => {
                            console.error('❌ Retry failed:', retryError);
                            handleGPSError(retryError);
                            setIsTracking(false);
                            setCurrentTrip(null);
                            alert('❌ GPS Failed\n\n✓ Enable Location\n✓ Allow permission\n✓ Go outdoors');
                        },
                        {
                            enableHighAccuracy: false,
                            timeout: 30000,
                            maximumAge: 10000
                        }
                    );
                } else {
                    handleGPSError(error);
                    setIsTracking(false);
                    setCurrentTrip(null);
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            }
        );
    };

    const stopTrip = () => {
        console.log('\n⏹️ ========== STOPPING GPS ==========');

        if (watchIdRef.current) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }

        if (currentTrip) {
            const completedTrip = {
                ...currentTrip,
                endTime: new Date().toISOString(),
                isActive: false
            };

            console.log('Trip completed:', completedTrip);
            setTrips(prev => [...prev, completedTrip]);
            setCurrentTrip(null);
        }

        lastPositionRef.current = null;
        positionCountRef.current = 0;
        positionHistoryRef.current = [];
        isFirstPositionAfterStart.current = true;
        setIsTracking(false);
        setGpsDebug(prev => ({ ...prev, status: 'Stopped' }));
        showGpsMessage('⏸️ Tracking stopped', false);

        console.log('Final Total:', totalKmSinceLastFill.toFixed(3), 'km');
    };

    const getMonthlySummary = () => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let totalLitres = 0;
        let totalSpent = 0;
        let totalKm = 0;

        petrolEntries.forEach(entry => {
            const entryDate = new Date(entry.date);
            if (entryDate.getMonth() === currentMonth && entryDate.getFullYear() === currentYear) {
                totalLitres += entry.litres;
                totalSpent += entry.totalCost;
                if (entry.kmTraveled > 0) {
                    totalKm += entry.kmTraveled;
                }
            }
        });

        const avgMileage = totalLitres > 0 ? (totalKm / totalLitres).toFixed(2) : '0';
        return { totalLitres, totalSpent, totalKm, avgMileage };
    };

    const renderDashboard = () => {
        const monthly = getMonthlySummary();
        const lastEntry = petrolEntries[0];
        const currentMileage = lastEntry && totalKmSinceLastFill > 0
            ? (totalKmSinceLastFill / lastEntry.litres).toFixed(2)
            : 'N/A';

        return (
            <div>
                {showInstallPrompt && canInstall && (
                    <div className="card install-prompt">
                        <h2>📱 Install App</h2>
                        <p style={{ color: '#93dac4', marginBottom: '15px', fontSize: '14px' }}>
                            Add to home screen for offline use!
                        </p>
                        <button className="btn btn-success" onClick={handleInstallClick}>
                            ⬇️ Install Now
                        </button>
                        <button
                            className="btn btn-secondary"
                            style={{ marginTop: '10px' }}
                            onClick={() => setShowInstallPrompt(false)}
                        >
                            Later
                        </button>
                    </div>
                )}

                {!canInstall && /iPhone|iPad|iPod/.test(navigator.userAgent) &&
                    !window.navigator.standalone && showInstallPrompt && (
                        <div className="card install-prompt">
                            <h2>📱 Install on iPhone</h2>
                            <div style={{ textAlign: 'left', color: '#93dac4', fontSize: '14px', lineHeight: '1.6' }}>
                                <p style={{ marginBottom: '10px' }}>To install:</p>
                                <ol style={{ paddingLeft: '20px' }}>
                                    <li>Tap Share button <strong>⬆️</strong></li>
                                    <li>Tap <strong>"Add to Home Screen"</strong></li>
                                    <li>Tap <strong>"Add"</strong></li>
                                </ol>
                            </div>
                            <button
                                className="btn btn-secondary"
                                style={{ marginTop: '15px' }}
                                onClick={() => setShowInstallPrompt(false)}
                            >
                                Got it
                            </button>
                        </div>
                    )}

                <div className="card">
                    <h2>🏍️ Current Tank</h2>
                    {petrolEntries.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">⛽</div>
                            <p>No petrol entry yet.<br />Add your first fill!</p>
                        </div>
                    ) : (
                        <div className="stats-grid">
                            <div className="stat-box">
                                <div className="stat-label">Litres</div>
                                <div className="stat-value">{lastEntry.litres}<span className="stat-unit">L</span></div>
                            </div>
                            <div className="stat-box">
                                <div className="stat-label">Distance</div>
                                <div className="stat-value">{totalKmSinceLastFill.toFixed(2)}<span className="stat-unit">km</span></div>
                            </div>
                            <div className="stat-box full-width">
                                <div className="stat-label">Mileage</div>
                                <div className="stat-value large">{currentMileage}<span className="stat-unit">km/L</span></div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="card">
                    <h2>📊 This Month</h2>
                    <div className="stats-grid">
                        <div className="stat-box">
                            <div className="stat-label">Litres</div>
                            <div className="stat-value">{monthly.totalLitres.toFixed(1)}<span className="stat-unit">L</span></div>
                        </div>
                        <div className="stat-box">
                            <div className="stat-label">Spent</div>
                            <div className="stat-value" style={{ fontSize: '20px' }}>₹{monthly.totalSpent.toFixed(0)}</div>
                        </div>
                        <div className="stat-box">
                            <div className="stat-label">Distance</div>
                            <div className="stat-value">{monthly.totalKm.toFixed(0)}<span className="stat-unit">km</span></div>
                        </div>
                        <div className="stat-box">
                            <div className="stat-label">Avg Mileage</div>
                            <div className="stat-value">{monthly.avgMileage}<span className="stat-unit">km/L</span></div>
                        </div>
                    </div>
                </div>

                {petrolEntries.length > 0 && (
                    <div className="card">
                        <h2>⚙️ Settings</h2>
                        <button className="btn btn-danger" onClick={handleResetRequest}>
                            🗑️ Reset All Data
                        </button>
                        <p style={{ color: '#93dac4', fontSize: '12px', marginTop: '10px', textAlign: 'center' }}>
                            Deletes all entries
                        </p>
                    </div>
                )}
            </div>
        );
    };

    const renderPetrolEntry = () => {
        return (
            <div className="card">
                <h2>⛽ Add Petrol</h2>

                <div className="input-group">
                    <label htmlFor="litres">Litres Filled</label>
                    <input
                        type="number"
                        id="litres"
                        placeholder="Enter litres"
                        step="0.01"
                        min="0"
                        value={litres}
                        onChange={(e) => setLitres(e.target.value)}
                        inputMode="decimal"
                    />
                </div>

                <div className="input-group">
                    <label htmlFor="pricePerLitre">Price per Litre (₹)</label>
                    <input
                        type="number"
                        id="pricePerLitre"
                        placeholder="Enter price"
                        step="0.01"
                        min="0"
                        value={pricePerLitre}
                        onChange={(e) => setPricePerLitre(e.target.value)}
                        inputMode="decimal"
                    />
                </div>

                <div className="input-group">
                    <label htmlFor="fillDate">Date</label>
                    <input
                        type="date"
                        id="fillDate"
                        value={fillDate}
                        onChange={(e) => setFillDate(e.target.value)}
                    />
                </div>

                {totalKmSinceLastFill > 0 && (
                    <div className="alert">
                        📍 Distance: <strong>{totalKmSinceLastFill.toFixed(2)} km</strong>
                    </div>
                )}

                <button className="btn btn-success" onClick={savePetrolEntry}>
                    💾 Save Entry
                </button>
            </div>
        );
    };

    const renderGPSTracker = () => {
        const currentTripKm = currentTrip && currentTrip.isActive
            ? currentTrip.distance.toFixed(2)
            : '0.00';

        return (
            <div className="card">
                <h2>📍 GPS Tracker</h2>

                <div style={{
                    background: isTracking ? 'linear-gradient(135deg, #1a4d6d 0%, #0f3460 100%)' : '#0f3460',
                    padding: '12px',
                    borderRadius: '10px',
                    marginBottom: '15px',
                    border: `2px solid ${isTracking ? '#4ecca3' : '#1a4d6d'}`,
                    fontSize: '12px'
                }}>
                    <div style={{ color: '#4ecca3', fontWeight: 'bold', marginBottom: '6px', fontSize: '13px' }}>
                        📡 {gpsDebug.status}
                    </div>
                    {isTracking && (
                        <div style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.5' }}>
                            Updates: <span style={{ color: '#4ecca3' }}>{gpsDebug.updates}</span> |
                            Accuracy: <span style={{ color: gpsDebug.accuracy < 20 ? '#4ecca3' : '#f4a261' }}>
                                {gpsDebug.accuracy.toFixed(0)}m
                            </span><br />
                            Speed: <span style={{ color: '#4ecca3' }}>{(gpsDebug.speed * 3.6).toFixed(1)} km/h</span>
                        </div>
                    )}
                </div>

                <div className="alert" style={{ marginBottom: '15px', backgroundColor: '#1a4d6d', fontSize: '13px' }}>
                    <strong>📱 Keep app open while tracking</strong><br />
                    GPS works best outdoors with clear sky view
                </div>

                <div className={`trip-status ${isTracking ? 'tracking' : ''}`}>
                    <div className="trip-label">CURRENT TRIP</div>
                    <div className="trip-distance">{currentTripKm}</div>
                    <div className="trip-label">KM</div>
                </div>

                <div className="trip-status">
                    <div className="trip-label">TOTAL SINCE FILL</div>
                    <div className="trip-distance" style={{ fontSize: '32px' }}>
                        {totalKmSinceLastFill.toFixed(2)}
                    </div>
                    <div className="trip-label">KM</div>
                </div>

                {!isTracking ? (
                    <>
                        <button className="btn btn-success btn-lg" onClick={startTrip}>
                            ▶️ START GPS
                        </button>
                        <button
                            className="btn btn-secondary btn-lg"
                            style={{ marginTop: '10px' }}
                            onClick={handleManualEntryRequest}
                        >
                            ✏️ ADD MANUAL KM
                        </button>
                    </>
                ) : (
                    <button className="btn btn-danger btn-lg" onClick={stopTrip}>
                        ⏹️ STOP GPS
                    </button>
                )}

                {showGpsAlert && (
                    <div className="alert alert-warning" style={{ marginTop: '15px' }}>
                        {gpsMessage}
                    </div>
                )}
            </div>
        );
    };

    const renderHistory = () => {
        return (
            <div className="card">
                <h2>📜 History</h2>
                {petrolEntries.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">📋</div>
                        <p>No entries yet</p>
                    </div>
                ) : (
                    <div>
                        {petrolEntries.map(entry => {
                            const date = new Date(entry.date);
                            const formattedDate = date.toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric'
                            });

                            return (
                                <div key={entry.id} className="history-item">
                                    <div className="history-header">
                                        <div className="history-date">{formattedDate}</div>
                                        <div className="history-mileage">
                                            {entry.mileage > 0 ? entry.mileage : 'N/A'} km/L
                                        </div>
                                    </div>
                                    <div className="history-details">
                                        <div className="history-detail">
                                            Litres: <span>{entry.litres}L</span>
                                        </div>
                                        <div className="history-detail">
                                            Cost: <span>₹{entry.totalCost.toFixed(0)}</span>
                                        </div>
                                        <div className="history-detail">
                                            Dist: <span>{entry.kmTraveled.toFixed(1)} km</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="App">
            {/* Manual KM Entry Modal */}
            {showManualEntry && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>✏️ Add Manual KM</h2>
                        <p style={{ color: '#93dac4', fontSize: '14px', marginBottom: '15px' }}>
                            Enter distance traveled when someone else rode the bike
                        </p>

                        <div className="input-group">
                            <label htmlFor="manualKm">Kilometers Traveled</label>
                            <input
                                type="number"
                                id="manualKm"
                                placeholder="Enter km"
                                step="0.1"
                                min="0"
                                value={manualKm}
                                onChange={(e) => setManualKm(e.target.value)}
                                inputMode="decimal"
                                autoFocus
                                style={{
                                    fontSize: '18px',
                                    padding: '15px',
                                    textAlign: 'center'
                                }}
                            />
                        </div>

                        <div className="modal-buttons">
                            <button className="btn btn-success" onClick={saveManualKm}>
                                ✅ Add KM
                            </button>
                            <button className="btn btn-secondary" onClick={cancelManualEntry}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reset Confirm Modal */}
            {showResetConfirm && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>⚠️ Confirm Reset</h2>
                        <p>Delete all data?</p>
                        <p style={{ color: '#ee6c4d', fontSize: '14px', marginTop: '10px' }}>
                            Cannot be undone!
                        </p>
                        <div className="modal-buttons">
                            <button className="btn btn-danger" onClick={confirmReset}>
                                Yes, Delete
                            </button>
                            <button className="btn btn-secondary" onClick={cancelReset}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="header">
                <h1>⛽ Petrol Tracker</h1>
                <p>Track fuel efficiency</p>
            </div>

            <div className="container">
                {activeScreen === 'dashboard' && renderDashboard()}
                {activeScreen === 'petrol' && renderPetrolEntry()}
                {activeScreen === 'gps' && renderGPSTracker()}
                {activeScreen === 'history' && renderHistory()}
            </div>

            <div className="bottom-nav">
                <button
                    className={`nav-btn ${activeScreen === 'dashboard' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('dashboard')}
                >
                    <div className="nav-icon">🏠</div>
                    <div>Home</div>
                </button>
                <button
                    className={`nav-btn ${activeScreen === 'petrol' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('petrol')}
                >
                    <div className="nav-icon">⛽</div>
                    <div>Fuel</div>
                </button>
                <button
                    className={`nav-btn ${activeScreen === 'gps' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('gps')}
                >
                    <div className="nav-icon">📍</div>
                    <div>Track</div>
                </button>
                <button
                    className={`nav-btn ${activeScreen === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('history')}
                >
                    <div className="nav-icon">📜</div>
                    <div>History</div>
                </button>
            </div>
        </div>
    );
}

export default App;