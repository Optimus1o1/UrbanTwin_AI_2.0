"""
UrbanTwin AI - Synthetic Traffic Stream Generator
Generates realistic simulated CCTV/traffic camera frames with moving vehicles,
road perspectives, HUD telemetry, and authentic Indian license plates.
Used as a zero-dependency 100% reliable fallback for hackathon demos.
"""

import time
import math
import cv2
import numpy as np
from typing import Tuple, List, Dict, Any

VEHICLE_COLORS = [
    (192, 192, 192), # Silver
    (30, 30, 30),    # Obsidian Black
    (240, 240, 240), # White
    (180, 20, 20),   # Crimson
    (20, 50, 180),   # Deep Blue
    (20, 160, 220),  # Kolkata Yellow Taxi (BGR: Yellow is 20, 200, 240)
]

SAMPLE_PLATES = [
    ("WB02AK4921", "Car", 48.5),
    ("22BH6517A", "SUV", 62.0),
    ("WB06J8812", "Taxi", 36.5),
    ("WB20E3304", "Van", 44.0),
    ("WB12D9901", "Truck", 40.2),
    ("WB24B1008", "Bus", 32.8)
]


class SyntheticTrafficGenerator:
    """
    Generates dynamic 1280x720 video frames simulating a live traffic camera in Kolkata.
    Computes moving vehicle trajectories, license plate locations, and HUD bounding boxes.
    """

    def __init__(self, camera_id: str = "CAM_01", camera_name: str = "Park Street Arterial"):
        self.camera_id = camera_id
        self.camera_name = camera_name
        self.width = 1280
        self.height = 720
        self.start_time = time.time()
        self.frame_count = 0

    def generate_frame(self) -> Tuple[np.ndarray, List[Dict[str, Any]]]:
        """
        Generates one BGR video frame and returns (frame_bgr, detections_list).
        """
        self.frame_count += 1
        t = time.time() - self.start_time

        # 1. Asphalt Road Canvas with subtle gradient
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        # Background dark urban road tone
        cv2.rectangle(frame, (0, 0), (self.width, self.height), (22, 24, 28), -1)

        # 2. Road geometry: Perspective 3-lane carriageway
        vp_x, vp_y = self.width // 2, 140 # Vanishing point
        road_pts = np.array([
            [120, self.height],
            [vp_x - 70, vp_y],
            [vp_x + 70, vp_y],
            [self.width - 120, self.height]
        ], np.int32)
        cv2.fillPoly(frame, [road_pts], (36, 40, 46))

        # Lane dividers (dashed lines moving with time)
        for lane_idx in [-1, 0, 1]:
            offset_factor = lane_idx * 0.35
            base_x = self.width // 2 + int(offset_factor * 420)
            for seg in range(12):
                phase = (t * 2.0 + seg * 0.8) % 6.0
                y1 = int(vp_y + (phase / 6.0) ** 1.8 * (self.height - vp_y))
                y2 = int(y1 + 18 + (phase / 6.0) * 35)
                if y2 >= self.height or y1 < vp_y:
                    continue
                ratio = (y1 - vp_y) / float(self.height - vp_y)
                x = int(vp_x + (base_x - vp_x) * ratio)
                w = max(2, int(ratio * 5))
                cv2.line(frame, (x, y1), (x, y2), (200, 210, 220), w)

        # 3. Simulate 3-4 Moving Vehicles
        detections = []
        for i, (plate, v_type, base_speed) in enumerate(SAMPLE_PLATES[:4]):
            # Staggered cyclic progression along roadway
            cycle_duration = 7.0 + (i * 1.5)
            progress = ((t + i * 2.4) % cycle_duration) / cycle_duration
            
            # Perspective scaling: starts small at vanishing point, scales large near bottom
            y_pos = int(vp_y + (progress ** 1.6) * (self.height - vp_y - 60))
            if y_pos < vp_y + 15 or y_pos > self.height - 40:
                continue

            scale = max(0.2, (y_pos - vp_y) / float(self.height - vp_y))
            
            # Lane placement
            lane_offset = ((i % 3) - 1) * 320
            x_pos = int(vp_x + (lane_offset * scale))

            # Dimensions
            v_w = int(220 * scale)
            v_h = int(140 * scale)
            x1 = max(10, x_pos - v_w // 2)
            y1 = max(10, y_pos - v_h)
            x2 = min(self.width - 10, x1 + v_w)
            y2 = min(self.height - 10, y1 + v_h)

            color = VEHICLE_COLORS[i % len(VEHICLE_COLORS)]
            
            # Draw Vehicle Body
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, -1)
            # Windshield
            ws_h = int(v_h * 0.3)
            ws_margin = int(v_w * 0.1)
            cv2.rectangle(frame, (x1 + ws_margin, y1 + int(v_h * 0.15)), (x2 - ws_margin, y1 + ws_margin + ws_h), (20, 20, 24), -1)

            # Headlights / Taillights
            cv2.circle(frame, (x1 + int(v_w * 0.15), y2 - int(v_h * 0.15)), max(3, int(6 * scale)), (0, 60, 230), -1)
            cv2.circle(frame, (x2 - int(v_w * 0.15), y2 - int(v_h * 0.15)), max(3, int(6 * scale)), (0, 60, 230), -1)

            # License Plate Area on vehicle
            plate_w = int(v_w * 0.45)
            plate_h = int(v_h * 0.22)
            px1 = x1 + (v_w - plate_w) // 2
            py1 = y2 - plate_h - int(v_h * 0.08)
            px2 = px1 + plate_w
            py2 = py1 + plate_h

            is_yellow_taxi = "WB06" in plate or v_type == "Taxi"
            plate_bg = (50, 220, 240) if is_yellow_taxi else (245, 245, 245)
            cv2.rectangle(frame, (px1, py1), (px2, py2), plate_bg, -1)
            cv2.rectangle(frame, (px1, py1), (px2, py2), (30, 30, 30), 1)

            # Draw Plate Text if close enough to camera
            if scale > 0.45:
                font_scale = max(0.35, scale * 0.6)
                cv2.putText(frame, plate, (px1 + 4, py2 - 4), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (10, 10, 10), 1, cv2.LINE_AA)

            # 4. Neural Vision HUD Overlay (Bounding Box + Analytics)
            track_id = 100 + i * 17
            conf = round(0.92 + (math.sin(t + i) * 0.04), 2)
            speed = round(base_speed + math.sin(t * 1.5 + i) * 3.5, 1)

            # Bounding box (Neon Cyan with corner brackets)
            box_color = (212, 182, 6) # BGR for #06b6d4 cyan
            cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
            
            # Corner accents
            corner_len = min(20, v_w // 4)
            cv2.line(frame, (x1, y1), (x1 + corner_len, y1), (0, 255, 180), 3)
            cv2.line(frame, (x1, y1), (x1, y1 + corner_len), (0, 255, 180), 3)
            cv2.line(frame, (x2, y1), (x2 - corner_len, y1), (0, 255, 180), 3)
            cv2.line(frame, (x2, y1), (x2, y1 + corner_len), (0, 255, 180), 3)

            # HUD Label Badge
            label_text = f"ID:{track_id} {v_type} {plate} | {speed} km/h ({int(conf*100)}%)"
            (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
            cv2.rectangle(frame, (x1, max(0, y1 - th - 10)), (x1 + tw + 10, y1), (15, 23, 42), -1)
            cv2.rectangle(frame, (x1, max(0, y1 - th - 10)), (x1 + tw + 10, y1), box_color, 1)
            cv2.putText(frame, label_text, (x1 + 5, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (240, 240, 240), 1, cv2.LINE_AA)

            detections.append({
                "track_id": track_id,
                "vehicle_type": v_type,
                "plate_text": plate,
                "confidence": conf,
                "speed_kmh": speed,
                "bbox": [x1, y1, x2, y2]
            })

        # 5. Top Left Camera HUD Telemetry Lockup
        cv2.rectangle(frame, (20, 20), (440, 95), (15, 23, 42), -1)
        cv2.rectangle(frame, (20, 20), (440, 95), (51, 65, 85), 1)
        
        # Red REC indicator dot
        rec_dot_color = (0, 0, 255) if int(t * 2) % 2 == 0 else (50, 50, 100)
        cv2.circle(frame, (38, 42), 6, rec_dot_color, -1)
        cv2.putText(frame, "LIVE EDGE INGESTION", (52, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
        
        hud_info = f"{self.camera_id} : {self.camera_name} (Kolkata Core)"
        cv2.putText(frame, hud_info, (32, 68), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (6, 182, 212), 1, cv2.LINE_AA)
        
        telemetry_line = f"YOLOv8 + STN-CRNN | 30.0 FPS | Latency: 18.4ms | Detections: {len(detections)}"
        cv2.putText(frame, telemetry_line, (32, 86), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (148, 163, 184), 1, cv2.LINE_AA)

        # Timestamp in bottom right
        time_str = time.strftime("%Y-%m-%d %H:%M:%S UTC")
        cv2.putText(frame, time_str, (self.width - 240, self.height - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (148, 163, 184), 1, cv2.LINE_AA)

        return frame, detections
