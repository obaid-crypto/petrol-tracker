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

    // GPS Debug Info
    const [gpsDebug, setGpsDebug] = useState({
        updates: 0,
        lastLat: 0,
        lastLng: 0,
        accuracy: 0,
        speed: 0,
        status: 'Not started'
    });

    const watchIdRef = useRef(null);
    const lastPositionRef = useRef(null);
    const isInitialMount = useRef(true);
    const positionCountRef = useRef(0);
    const retryTimeoutRef = useRef(null);

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
                // Don't show error alert for timeout, we'll retry
                setGpsDebug(prev => ({ ...prev, status }));
                return; // Don't show alert, just retry
            default:
                message = 'GPS error: ' + error.message;
                status = 'Error';
        }

        setGpsDebug(prev => ({ ...prev, status }));
        showGpsMessage(message, true);
    }, [showGpsMessage]);

    // Main GPS update function
    const handlePositionUpdate = useCallback((position) => {
        positionCountRef.current += 1;
        const updateNum = positionCountRef.current;

        console.log(`\n========== GPS Update #${updateNum} ==========`);
        console.log('Time:', new Date().toLocaleTimeString());
        console.log('Lat:', position.coords.latitude.toFixed(6));
        console.log('Lng:', position.coords.longitude.toFixed(6));
        console.log('Accuracy:', position.coords.accuracy.toFixed(1), 'm');
        console.log('Speed:', position.coords.speed, 'm/s');

        // Update debug display
        setGpsDebug({
            updates: updateNum,
            lastLat: position.coords.latitude,
            lastLng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || 0,
            status: 'Active ✓'
        });

        const newPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
        };

        if (lastPositionRef.current) {
            const distance = calculateDistance(
                lastPositionRef.current.lat,
                lastPositionRef.current.lng,
                newPosition.lat,
                newPosition.lng
            );

            const distanceMeters = distance * 1000;
            console.log('Distance:', distanceMeters.toFixed(2), 'm');

            // Lower threshold and looser accuracy for better tracking
            if (distanceMeters > 3 && position.coords.accuracy < 100) {
                console.log('✅ UPDATING DISTANCE');

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

                lastPositionRef.current = newPosition;
            } else {
                if (distanceMeters <= 3) console.log('⏭️ Distance < 3m');
                if (position.coords.accuracy >= 100) console.log('⏭️ Accuracy > 100m');
            }
        } else {
            console.log('ℹ️ First position - setting reference');
            lastPositionRef.current = newPosition;
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
            setDeferredPrompt(e);
            setShowInstallPrompt(true);
        };

        window.addEventListener('beforeinstallprompt', handler);

        if (window.matchMedia('(display-mode: standalone)').matches) {
            setShowInstallPrompt(false);
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
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
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

        setGpsDebug({
            updates: 0,
            lastLat: 0,
            lastLng: 0,
            accuracy: 0,
            speed: 0,
            status: 'Not started'
        });

        localStorage.removeItem('petrolTrackerData');

        setShowResetConfirm(false);
        setActiveScreen('dashboard');

        alert('✅ All data has been reset!');
    };

    const cancelReset = () => {
        setShowResetConfirm(false);
    };

    const handleInstallClick = async () => {
        if (!deferredPrompt) {
            return;
        }

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            setShowInstallPrompt(false);
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

        alert('✅ Petrol entry saved successfully!');
        setActiveScreen('dashboard');
    };

    // START GPS WITH BETTER TIMEOUT HANDLING
    const startTrip = () => {
        console.log('\n🚀 ========== STARTING GPS ==========');

        if (!navigator.geolocation) {
            alert('❌ GPS not supported on this device/browser');
            return;
        }

        // Reset
        positionCountRef.current = 0;
        lastPositionRef.current = null;

        setGpsDebug(prev => ({ ...prev, status: 'Getting initial position...' }));

        const newTrip = {
            id: Date.now(),
            startTime: new Date().toISOString(),
            distance: 0,
            isActive: true
        };

        setCurrentTrip(newTrip);
        setIsTracking(true);

        console.log('Requesting initial GPS lock...');
        console.log('💡 TIP: Go outside for better signal!');

        // Try to get initial position with longer timeout
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('✅ Initial GPS lock successful!');
                console.log('Position:', position.coords);

                lastPositionRef.current = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                };

                setGpsDebug(prev => ({ ...prev, status: 'GPS locked! Starting watch...' }));

                // Start continuous tracking with more lenient settings
                console.log('Starting GPS watch...');

                watchIdRef.current = navigator.geolocation.watchPosition(
                    handlePositionUpdate,
                    handleGPSError,
                    {
                        enableHighAccuracy: true,
                        timeout: 30000,        // Increased to 30 seconds
                        maximumAge: 5000       // Allow cached position up to 5 seconds old
                    }
                );

                console.log('✅ GPS watch started! ID:', watchIdRef.current);
                showGpsMessage('🟢 GPS Active!', false);
                setGpsDebug(prev => ({ ...prev, status: 'Tracking active ✓' }));
            },
            (error) => {
                console.error('❌ Initial GPS lock failed:', error);

                if (error.code === 3) {
                    // Timeout - try with lower accuracy
                    console.log('⚠️ Timeout with high accuracy. Trying with normal accuracy...');

                    setGpsDebug(prev => ({ ...prev, status: 'Retrying with normal GPS...' }));

                    navigator.geolocation.getCurrentPosition(
                        (position) => {
                            console.log('✅ Got position with normal accuracy');

                            lastPositionRef.current = {
                                lat: position.coords.latitude,
                                lng: position.coords.longitude,
                                accuracy: position.coords.accuracy
                            };

                            watchIdRef.current = navigator.geolocation.watchPosition(
                                handlePositionUpdate,
                                handleGPSError,
                                {
                                    enableHighAccuracy: false,  // Use normal GPS
                                    timeout: 30000,
                                    maximumAge: 10000
                                }
                            );

                            showGpsMessage('🟡 GPS Active (Normal Mode)', false);
                            setGpsDebug(prev => ({ ...prev, status: 'Active (Normal GPS) ✓' }));
                        },
                        (retryError) => {
                            console.error('❌ Retry also failed:', retryError);
                            handleGPSError(retryError);
                            setIsTracking(false);
                            setCurrentTrip(null);

                            alert('❌ GPS Error\n\n' +
                                'Could not get GPS signal.\n\n' +
                                '✓ Make sure Location is ON\n' +
                                '✓ Go outside for better signal\n' +
                                '✓ Allow location permission\n' +
                                '✓ Wait in one spot for 30 seconds');
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
                timeout: 20000,        // 20 second timeout for initial lock
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

        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
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
                {showInstallPrompt && (
                    <div className="card install-prompt">
                        <h2>📱 Install App</h2>
                        <p style={{ color: '#93dac4', marginBottom: '15px' }}>
                            Install on your home screen for offline use!
                        </p>
                        <button className="btn btn-success" onClick={handleInstallClick}>
                            ⬇️ Install Now
                        </button>
                        <button
                            className="btn btn-secondary"
                            style={{ marginTop: '10px' }}
                            onClick={() => setShowInstallPrompt(false)}
                        >
                            Maybe Later
                        </button>
                    </div>
                )}

                <div className="card">
                    <h2>🏍️ Current Tank</h2>
                    {petrolEntries.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">⛽</div>
                            <p>No petrol entry yet.<br />Add your first fill to start!</p>
                        </div>
                    ) : (
                        <div className="stats-grid">
                            <div className="stat-box">
                                <div className="stat-label">Litres Filled</div>
                                <div className="stat-value">{lastEntry.litres}<span className="stat-unit">L</span></div>
                            </div>
                            <div className="stat-box">
                                <div className="stat-label">Distance</div>
                                <div className="stat-value">{totalKmSinceLastFill.toFixed(3)}<span className="stat-unit">km</span></div>
                            </div>
                            <div className="stat-box full-width">
                                <div className="stat-label">Current Mileage</div>
                                <div className="stat-value large">{currentMileage}<span className="stat-unit">km/L</span></div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="card">
                    <h2>📊 This Month</h2>
                    <div className="stats-grid">
                        <div className="stat-box">
                            <div className="stat-label">Total Litres</div>
                            <div className="stat-value">{monthly.totalLitres.toFixed(2)}<span className="stat-unit">L</span></div>
                        </div>
                        <div className="stat-box">
                            <div className="stat-label">Total Spent</div>
                            <div className="stat-value">₹{monthly.totalSpent.toFixed(2)}</div>
                        </div>
                        <div className="stat-box">
                            <div className="stat-label">Total KM</div>
                            <div className="stat-value">{monthly.totalKm.toFixed(2)}<span className="stat-unit">km</span></div>
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
                            Deletes all entries and trip data
                        </p>
                    </div>
                )}
            </div>
        );
    };

    const renderPetrolEntry = () => {
        return (
            <div className="card">
                <h2>⛽ Add Petrol Entry</h2>

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
                        📍 Distance covered: <strong>{totalKmSinceLastFill.toFixed(3)} km</strong>
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
            ? currentTrip.distance.toFixed(3)
            : '0.000';

        return (
            <div className="card">
                <h2>📍 GPS Trip Tracker</h2>

                {/* GPS Status & Debug */}
                <div style={{
                    background: isTracking ? '#1a4d6d' : '#0f3460',
                    padding: '15px',
                    borderRadius: '10px',
                    marginBottom: '15px',
                    border: `2px solid ${isTracking ? '#4ecca3' : '#1a4d6d'}`,
                    fontSize: '13px'
                }}>
                    <div style={{ color: '#4ecca3', fontWeight: 'bold', marginBottom: '8px' }}>
                        📡 GPS Status: {gpsDebug.status}
                    </div>
                    {isTracking && (
                        <div style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: '12px' }}>
                            Updates: <span style={{ color: '#4ecca3' }}>{gpsDebug.updates}</span><br />
                            Latitude: <span style={{ color: '#4ecca3' }}>{gpsDebug.lastLat.toFixed(6)}</span><br />
                            Longitude: <span style={{ color: '#4ecca3' }}>{gpsDebug.lastLng.toFixed(6)}</span><br />
                            Accuracy: <span style={{ color: gpsDebug.accuracy < 20 ? '#4ecca3' : '#f4a261' }}>
                                {gpsDebug.accuracy.toFixed(1)}m
                            </span><br />
                            Speed: <span style={{ color: '#4ecca3' }}>{(gpsDebug.speed * 3.6).toFixed(1)} km/h</span>
                        </div>
                    )}
                </div>

                <div className="alert" style={{ marginBottom: '15px', backgroundColor: '#1a4d6d' }}>
                    <strong>🎯 GPS Tips:</strong><br />
                    ✓ Go OUTSIDE (indoors won't work)<br />
                    ✓ Stand still for 30 seconds first<br />
                    ✓ Clear view of sky (away from buildings)<br />
                    ✓ Walk at least 50-100 meters<br />
                    ✓ Keep app open while tracking
                </div>

                <div className={`trip-status ${isTracking ? 'tracking' : ''}`}>
                    <div className="trip-label">CURRENT TRIP</div>
                    <div className="trip-distance">{currentTripKm}</div>
                    <div className="trip-label">KILOMETERS</div>
                </div>

                <div className="trip-status">
                    <div className="trip-label">TOTAL SINCE LAST FILL</div>
                    <div className="trip-distance" style={{ fontSize: '36px' }}>
                        {totalKmSinceLastFill.toFixed(3)}
                    </div>
                    <div className="trip-label">KILOMETERS</div>
                </div>

                {!isTracking ? (
                    <button className="btn btn-success btn-lg" onClick={startTrip}>
                        ▶️ START TRACKING
                    </button>
                ) : (
                    <button className="btn btn-danger btn-lg" onClick={stopTrip}>
                        ⏹️ STOP TRACKING
                    </button>
                )}

                {showGpsAlert && (
                    <div className="alert alert-warning">
                        ⚠️ {gpsMessage}
                    </div>
                )}
            </div>
        );
    };

    const renderHistory = () => {
        return (
            <div className="card">
                <h2>📜 Fuel History</h2>
                {petrolEntries.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">📋</div>
                        <p>No entries yet.<br />Add a petrol fill to start!</p>
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
                                            Cost: <span>₹{entry.totalCost.toFixed(2)}</span>
                                        </div>
                                        <div className="history-detail">
                                            Distance: <span>{entry.kmTraveled.toFixed(3)} km</span>
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
            {showResetConfirm && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>⚠️ Confirm Reset</h2>
                        <p>Delete ALL data permanently?</p>
                        <p style={{ color: '#ee6c4d', fontSize: '14px', marginTop: '10px' }}>
                            This cannot be undone!
                        </p>
                        <div className="modal-buttons">
                            <button className="btn btn-danger" onClick={confirmReset}>
                                Yes, Delete Everything
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
                <p>Track your bike's fuel efficiency</p>
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
                    <div>Dashboard</div>
                </button>
                <button
                    className={`nav-btn ${activeScreen === 'petrol' ? 'active' : ''}`}
                    onClick={() => setActiveScreen('petrol')}
                >
                    <div className="nav-icon">⛽</div>
                    <div>Add Fuel</div>
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