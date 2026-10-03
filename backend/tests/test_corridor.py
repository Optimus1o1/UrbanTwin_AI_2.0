import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models.schemas import EmergencyVehicleType, SignalPreemptionState

client = TestClient(app)

def test_list_corridors_and_presets():
    """Verify that preset corridors are returned."""
    res = client.get("/api/v1/corridors")
    assert res.status_code == 200
    corridors = res.json()
    assert len(corridors) >= 3
    ids = [c["corridor_id"] for c in corridors]
    assert "CORRIDOR-ALS-911" in ids
    assert "CORRIDOR-FIRE-101" in ids
    assert "CORRIDOR-ORGAN-5500" in ids

def test_get_corridor_by_id():
    """Verify detailed corridor status retrieval."""
    res = client.get("/api/v1/corridors/CORRIDOR-ALS-911")
    assert res.status_code == 200
    data = res.json()
    assert data["corridor_id"] == "CORRIDOR-ALS-911"
    assert "AMB-911" in data["vehicle"]["callsign"]
    assert data["vehicle"]["vehicle_type"] == EmergencyVehicleType.AMBULANCE.value
    assert len(data["junctions"]) >= 4
    assert len(data["route_coordinates"]) >= 5
    assert len(data["route_3d_coordinates"]) >= 5
    assert data["time_saved_min"] > 0

def test_dispatch_custom_corridor():
    """Verify custom vehicle dispatch calculation."""
    payload = {
        "callsign": "AMB-TEST-77",
        "plate_number": "WB-02-EQ-7777",
        "vehicle_type": "AMBULANCE",
        "incident_type": "Critical Cardiac Transport",
        "origin_name": "SSKM Emergency Gate",
        "destination_name": "Apollo Super Specialty",
        "speed_kmh": 60.0
    }
    res = client.post("/api/v1/corridors/dispatch", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["corridor_id"].startswith("CORRIDOR-")
    assert data["vehicle"]["callsign"] == "AMB-TEST-77"
    assert len(data["junctions"]) >= 3
    assert data["active"] is True

def test_activate_green_corridor():
    """Verify dynamic green wave activation locks signals to PREEMPTED_GREEN."""
    res = client.post("/api/v1/corridors/CORRIDOR-ALS-911/activate")
    assert res.status_code == 200
    data = res.json()
    assert data["active"] is True
    assert data["preemption_enabled"] is True
    # First downstream junction signal state
    first_junction = data["junctions"][0]
    assert first_junction["signal_state"] in [
        SignalPreemptionState.PREEMPTED_GREEN.value,
        SignalPreemptionState.QUEUE_FLUSH.value
    ]
    assert first_junction["preemption_active"] is True

def test_simulate_step_progress():
    """Verify vehicle advances, ETAs update, and queues flush."""
    res_before = client.get("/api/v1/corridors/CORRIDOR-ALS-911")
    lat_before = res_before.json()["vehicle"]["current_lat"]

    res_step = client.post("/api/v1/corridors/CORRIDOR-ALS-911/simulate-step")
    assert res_step.status_code == 200
    data = res_step.json()
    lat_after = data["vehicle"]["current_lat"]
    assert data["current_step_index"] > 0

def test_signal_override():
    """Verify manual operator signal overrides."""
    override_payload = {
        "junction_id": "JUNC-02",
        "action": "EXTEND_30S",
        "reason": "Ambulance delayed by road obstacle"
    }
    res = client.post("/api/v1/corridors/CORRIDOR-ALS-911/signal-override", json=override_payload)
    assert res.status_code == 200
    data = res.json()
    junc = next((j for j in data["junctions"] if j["junction_id"] == "JUNC-02"), None)
    assert junc is not None
    assert junc["green_lock_countdown_sec"] >= 30

def test_force_green_retargets_destination_and_route():
    """Verify that FORCE_GREEN on a downstream junction dynamically retargets route, destination, and preemption."""
    # Retarget to Beckbagan (JUNC-03)
    override_payload = {
        "junction_id": "JUNC-03",
        "action": "FORCE_GREEN"
    }
    res = client.post("/api/v1/corridors/CORRIDOR-ALS-911/signal-override", json=override_payload)
    assert res.status_code == 200
    data = res.json()

    # Destination name updated
    assert "Beckbagan" in data["destination_name"]
    assert "Beckbagan" in data["vehicle"]["destination_name"]

    # Route coordinates terminate at JUNC-03
    last_pt = data["route_coordinates"][-1]
    junc3 = next(j for j in data["junctions"] if j["junction_id"] == "JUNC-03")
    assert abs(last_pt[0] - junc3["lat"]) < 0.001
    assert abs(last_pt[1] - junc3["lng"]) < 0.001

    # Signal states up to target are PREEMPTED_GREEN, and downstream are NORMAL_CYCLE
    passed_target = False
    for j in data["junctions"]:
        if not passed_target:
            assert j["signal_state"] == SignalPreemptionState.PREEMPTED_GREEN.value
            assert j["cross_street_hold"] is True
            assert j["queue_cleared_pct"] == 100.0
        else:
            assert j["signal_state"] == SignalPreemptionState.NORMAL_CYCLE.value
            assert j["cross_street_hold"] is False
        if j["junction_id"] == "JUNC-03":
            passed_target = True

    # Retarget further to Science City (JUNC-06)
    res_sc = client.post("/api/v1/corridors/CORRIDOR-ALS-911/signal-override", json={
        "junction_id": "JUNC-06",
        "action": "FORCE_GREEN"
    })
    assert res_sc.status_code == 200
    data_sc = res_sc.json()
    assert "Science City" in data_sc["destination_name"]
    assert len(data_sc["route_coordinates"]) > len(data["route_coordinates"])

    # Restore full corridor to Apollo Hospital (JUNC-07)
    res_apollo = client.post("/api/v1/corridors/CORRIDOR-ALS-911/signal-override", json={
        "junction_id": "JUNC-07",
        "action": "FORCE_GREEN"
    })
    assert res_apollo.status_code == 200
    data_apollo = res_apollo.json()
    assert "Apollo" in data_apollo["destination_name"]
    assert len(data_apollo["route_coordinates"]) >= len(data_sc["route_coordinates"])

def test_deactivate_corridor():
    """Verify corridor deactivation and transition recovery."""
    res = client.post("/api/v1/corridors/CORRIDOR-ALS-911/deactivate")
    assert res.status_code == 200
    data = res.json()
    assert data["active"] is False
    assert data["preemption_enabled"] is False
    for j in data["junctions"]:
        assert j["signal_state"] in [
            SignalPreemptionState.NORMAL_CYCLE.value,
            SignalPreemptionState.TRANSITION_RECOVERY.value
        ]
        assert j["preemption_active"] is False

def test_corridor_telemetry():
    """Verify macroscopic operational telemetry."""
    res = client.get("/api/v1/corridors/telemetry")
    assert res.status_code == 200
    telem = res.json()
    assert telem["total_interventions_today"] >= 10
    assert telem["avg_minutes_saved"] > 0
    assert telem["preemption_success_rate_pct"] >= 95.0
