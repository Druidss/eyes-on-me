"""Quick diagnostic: find and connect to a Tobii Pro eye tracker."""

import os
import sys
from pathlib import Path

SDK_PATH = str(Path(__file__).resolve().parents[1] / "tools" / "SDK")
PYD_DIR  = str(Path(__file__).resolve().parents[1] / "tools" / "SDK" / "tobiiresearch" / "interop" / "python3")

sys.path.insert(0, SDK_PATH)

PY310_DIR = r"C:\Users\druid\AppData\Local\Python\pythoncore-3.10-64"

for _d in [SDK_PATH, PYD_DIR, PY310_DIR]:
    if Path(_d).is_dir():
        os.add_dll_directory(_d)

print(f"SDK path: {SDK_PATH}")
print(f"PYD dir:  {PYD_DIR}")

try:
    import tobii_research as tr
    print(f"tobii_research OK, version: {tr.__version__}")
except ImportError as e:
    print(f"Import failed: {e}")
    sys.exit(1)

trackers = tr.find_all_eyetrackers()
if not trackers:
    print("No eye trackers found. Check USB connection and Tobii service.")
    sys.exit(1)

et = trackers[0]
print(f"Found: {et.model}")
print(f"  Address : {et.address}")
print(f"  Serial  : {et.serial_number}")
print(f"  Firmware: {et.firmware_version}")

# Subscribe to gaze data for 3 seconds
import time

samples = []

def on_gaze(gaze_data):
    left  = gaze_data.left_eye.gaze_point
    right = gaze_data.right_eye.gaze_point
    if left.validity and right.validity:
        x = (left.position_on_display_area[0] + right.position_on_display_area[0]) / 2
        y = (left.position_on_display_area[1] + right.position_on_display_area[1]) / 2
        samples.append((round(x, 3), round(y, 3)))

et.subscribe_to(tr.EYETRACKER_GAZE_DATA, on_gaze)
print("\nReceiving gaze data for 3 seconds, look at the screen...")
time.sleep(3)
et.unsubscribe_from(tr.EYETRACKER_GAZE_DATA, on_gaze)

print(f"Received {len(samples)} samples")
if samples:
    print(f"Last sample: x={samples[-1][0]}, y={samples[-1][1]}")
    print("SUCCESS: Eye tracker is working correctly.")
else:
    print("WARNING: No valid gaze samples received.")
