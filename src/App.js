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

    const watchIdRef = useRef(null);
    const lastPositionRef = useRef(null);
    const isInitialMount = useRef(true);

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
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = 'Please allow GPS permission in browser settings';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'GPS position unavailable. Go outdoors for better signal.';
                break;
            case error.TIMEOUT:
                message = 'GPS request timeout. Try again.';
                break;
            default:
                message = 'GPS error occurred';
        }
        showGpsMessage(message, true);
        alert('❌ ' + message);
    }, [showGpsMessage]);

    useEffect(() => {
        console.log('Loading data from localStorage...');
        const loadData = () => {
            try {
                const stored = localStorage.getItem('petrolTrackerData');

                if (stored) {
                    const data = JSON.parse(stored);
                    console.log('Loaded data:', data);

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

    const updatePosition = useCallback((position) => {
        console.log('📊 Position Update');

        if (!currentTrip || !currentTrip.isActive) {
            console.log('⚠️ No active trip');
            return;
        }

        const newPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };

        console.log('New pos:', newPosition.lat.toFixed(6), newPosition.lng.toFixed(6));

        if (lastPositionRef.current) {
            const distance = calculateDistance(
                lastPositionRef.current.lat,
                lastPositionRef.current.lng,
                newPosition.lat,
                newPosition.lng
            );

            console.log('Distance:', (distance * 1000).toFixed(2), 'meters');

            // Reduced threshold to 5 meters for better tracking
            if (distance > 0.005) {
                console.log('✅ Updating distance');

                setCurrentTrip(prev => ({
                    ...prev,
                    distance: prev.distance + distance
                }));

                setTotalKmSinceLastFill(prev => prev + distance);
            }
        }

        lastPositionRef.current = newPosition;
    }, [currentTrip, calculateDistance]);

    useEffect(() => {
        const resumeTripOnMount = () => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    lastPositionRef.current = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };

                    watchIdRef.current = navigator.geolocation.watchPosition(
                        updatePosition,
                        handleGPSError,
                        {
                            enableHighAccuracy: true,
                            timeout: 10000,
                            maximumAge: 0
                        }
                    );

                    setIsTracking(true);
                    showGpsMessage('🟢 Tracking resumed...', false);
                },
                handleGPSError
            );
        };

        if (currentTrip && currentTrip.isActive) {
            console.log('Resuming active trip...');
            resumeTripOnMount();
        }

        return () => {
            if (watchIdRef.current) {
                navigator.geolocation.clearWatch(watchIdRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const startTrip = () => {
        console.log('🚀 Start Trip Clicked');

        if (!navigator.geolocation) {
            console.error('❌ Geolocation not supported');
            showGpsMessage('GPS not supported', true);
            alert('❌ Your browser/device does not support GPS tracking');
            return;
        }

        console.log('✅ Requesting GPS permission...');

        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('✅ GPS Permission Granted!');
                console.log('📍 Start Position:', position.coords);

                const newTrip = {
                    id: Date.now(),
                    startTime: new Date().toISOString(),
                    distance: 0,
                    isActive: true
                };

                setCurrentTrip(newTrip);

                lastPositionRef.current = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };

                console.log('Starting GPS watch...');

                watchIdRef.current = navigator.geolocation.watchPosition(
                    updatePosition,
                    handleGPSError,
                    {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    }
                );

                console.log('Watch ID:', watchIdRef.current);
                setIsTracking(true);
                showGpsMessage('🟢 GPS Tracking Active!', false);
                alert('✅ Tracking Started!\n\nStart moving and watch distance update.\n\nNote: Works best outdoors with clear sky view.');
            },
            (error) => {
                console.error('❌ GPS Error:', error);
                handleGPSError(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    };

    const stopTrip = () => {
        console.log('⏹️ Stop Trip Clicked');

        if (watchIdRef.current) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
            console.log('GPS watch stopped');
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
        setIsTracking(false);
        showGpsMessage('⏸️ Tracking stopped', false);

        alert('⏹️ Tracking Stopped!\n\nTotal distance: ' + totalKmSinceLastFill.toFixed(2) + ' km');
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
                            Install Petrol Tracker on your home screen for quick access and offline use!
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
                            <p>No petrol entry yet.<br />Add your first fill to start tracking!</p>
                        </div>
                    ) : (
                        <div className="stats-grid">
                            <div className="stat-box">
                                <div className="stat-label">Litres Filled</div>
                                <div className="stat-value">{lastEntry.litres}<span className="stat-unit">L</span></div>
                            </div>
                            <div className="stat-box">
                                <div className="stat-label">Distance</div>
                                <div className="stat-value">{totalKmSinceLastFill.toFixed(2)}<span className="stat-unit">km</span></div>
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
                            This will delete all petrol entries and trip data
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
                        📍 Distance covered: <strong>{totalKmSinceLastFill.toFixed(2)} km</strong>
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
                <h2>📍 GPS Trip Tracker</h2>

                <div className="alert" style={{ marginBottom: '15px', backgroundColor: '#1a4d6d' }}>
                    <strong>💡 Tips for Best Results:</strong><br />
                    • Go outdoors for better GPS signal<br />
                    • Wait 30 seconds for GPS to lock<br />
                    • Start moving (walk/ride at least 50m)<br />
                    • Keep app open while tracking
                </div>

                <div className={`trip-status ${isTracking ? 'tracking' : ''}`}>
                    <div className="trip-label">CURRENT TRIP</div>
                    <div className="trip-distance">{currentTripKm}</div>
                    <div className="trip-label">KILOMETERS</div>
                </div>

                <div className="trip-status">
                    <div className="trip-label">TOTAL SINCE LAST FILL</div>
                    <div className="trip-distance" style={{ fontSize: '36px' }}>{totalKmSinceLastFill.toFixed(2)}</div>
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

                {isTracking && (
                    <div className="alert" style={{ marginTop: '15px', backgroundColor: '#1a4d6d', borderColor: '#4ecca3' }}>
                        ✅ Tracking Active!<br />
                        <small>Distance updates every few seconds as you move</small>
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
                        <p>No entries yet.<br />Start by adding a petrol fill!</p>
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
                                            Distance: <span>{entry.kmTraveled.toFixed(2)} km</span>
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
                        <p>Are you sure you want to delete ALL data?</p>
                        <p style={{ color: '#ee6c4d', fontSize: '14px', marginTop: '10px' }}>
                            This action cannot be undone!
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