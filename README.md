# Eyes On Me

**Eyes On Me** is an interactive, gaze-aware detective interrogation game built on top of the *Gaze-Aware Avatar Study Kit*. The player takes on the role of an undercover agent inside the office of Director Vane, tasking them with collecting clues around the room and answering debriefing questions while the avatar monitors their gaze. Looking away/scanning the room while Vane makes direct eye contact increases suspicion, which can ultimately lead to arrest.

---

## Setup & Installation

Before running the start scripts or launching the servers for the first time, you must install the dependencies for both the backend and frontend:

### 1. Backend Setup
1. Navigate to the `backend` folder:
   ```bash
   cd backend
   ```
2. Create a virtual environment and install packages:
   ```bash
   python -m venv .venv
   # Windows (PowerShell):
   .venv\Scripts\Activate.ps1
   # Linux / macOS:
   source .venv/bin/activate

   # Installing dev and tobii dependencies is required for eye-tracking
   pip install -e ".[dev,tobii]"
   ```

### 2. Frontend Setup
1. Navigate to the `frontend` folder:
   ```bash
   cd frontend
   ```
2. Install Node packages (you can use your system's `npm` or the portable Node/npm inside `temp/node-v22.23.1-win-x64`):
   ```bash
   npm ci
   ```

### 3. Environment Configuration (`.env`)
To run the project with the Tobii eye tracker, you must create a `.env` file inside the `backend` folder:
1. In the project root, copy the `.env.example` template to `backend/.env`:
   ```bash
   cp .env.example backend/.env
   ```
2. Open `backend/.env` and edit configurations as needed:
   * **Tobii Eye Tracking:** Set `TOBII_ENABLED=true` to enable eye-gaze control.
     * **Tobii Pro SDK:** (Recommended / Default if available) Connects directly to Tobii Pro eye trackers (such as the Tobii Pro Spark). This requires the `tobii_research` library. You can either install it in your environment or place the SDK files in a `tools/SDK/` folder.
     * **ZMQ Fallback (`TobiiStream.exe`):** Used for standard consumer eye trackers (such as the Tobii EyeX or Tracker 4C). Set `TOBIISTREAM_PATH=tools/TobiiStream/TobiiStream/TobiiStream.exe`. 
       * *Setup:* Download the public ZMQ bridge [TobiiStream.zip](http://web.tecnico.ulisboa.pt/augusto.esteves/GazeTrack/TobiiStream.zip), unzip it, and place its contents inside a `tools/TobiiStream/` folder in the project root.

---

## Starting the Project

The game can be started in two ways:

### Method 1: Automatic Launch (Recommended)

* **Windows:** Double-click the `start_game.bat` file in the project's root directory. This automatically launches both the backend (API server) and the frontend (Vite development server with a portable Node.js v22 runtime pre-configured) in separate terminals.
* **Linux / macOS:** Run the startup shell script in the root directory:
  ```bash
  chmod +x start_game.sh
  ./start_game.sh
  ```
  This runs both servers in the background and terminates them cleanly when you press `Ctrl+C`.

Once the servers are running, access the game at:
* **Normal Game (Immersive Mode):** [http://localhost:5173/](http://localhost:5173/)  
  *Plays the clean, immersive game without debug overlays or visible metrics, ideal for study participants.*
* **Demo / Debug Mode (with Gaze Zones & Stats HUD):** [http://localhost:5173/?p1demo](http://localhost:5173/?p1demo)  
  *Displays bounding boxes around the gaze zones (eye-contact zone, body zone, and desk/wall hints) and shows a HUD overlay on the top-left with live tracking statistics (such as suspicion level, overall suspicion, rapport, dwell time, and eye-contact duration).*

---

### Method 2: Manual Launch

If you prefer to start the servers manually, open two separate terminals in the project's root directory and run the following:

1. **Backend (API Server):**
   ```bash
   cd backend
   .venv\Scripts\activate
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```
2. **Frontend (Vite Server):**
   ```cmd
   cd frontend
   set PATH=..\temp\node-v22.23.1-win-x64;%PATH%
   npm run dev
   ```

The game is then accessible at the URLs mentioned above.


---

## Authors & Project Members

This project was developed by:
* **Sebastian Hausler**
* **Tian Lev Majdič**
* **Yuxuan Yang**
* **Xinyue Zhang**
